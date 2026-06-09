"""Application settings + path helpers.

Settings are loaded from the environment (Design maître §6). Paths inside
``DATA_DIR`` are resolved and confined via :meth:`Settings.abs_path` so that no
caller can escape the storage root (defense in depth against path traversal).
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional


def _jwt_role(token: str) -> Optional[str]:
    """Best-effort read of the ``role`` claim from a JWT, WITHOUT verifying it.

    Used only for a startup sanity check on the service key — never for auth.
    Returns ``None`` if ``token`` is not a decodable JWT.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return None
    role = data.get("role")
    return role if isinstance(role, str) else None


def service_role_key_issue(key: str) -> Optional[str]:
    """Return a human-readable reason if ``key`` is *provably* not a service key.

    Guards against the classic misconfiguration where the project's **anon /
    publishable** key is pasted into ``SUPABASE_SERVICE_ROLE_KEY``. Such a key
    cannot bypass RLS, so every service-role query silently returns zero rows —
    e.g. :func:`supa.category_belongs_to_user` is always False, surfacing as a
    ``400 "Unknown category"`` on ingest. Only flags keys we can prove are
    wrong; empty / opaque values pass (dev tolerates an unset key).
    """
    if not key:
        return None
    if key.startswith("sb_publishable_"):
        return "looks like a PUBLISHABLE (anon) key — it cannot bypass RLS"
    role = _jwt_role(key)
    if role and role != "service_role":
        return f"is a JWT with role={role!r} (expected 'service_role') — it cannot bypass RLS"
    return None


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    media_token_secret: str
    data_dir: Path
    ig_cookies_file: Optional[str]
    max_video_mb: int

    # --- directory helpers -------------------------------------------------
    @property
    def videos_dir(self) -> Path:
        return self.data_dir / "videos"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    # --- relative path builders (stored in DB) -----------------------------
    def rel_video_path(self, user_id: str, video_id: str) -> str:
        return f"videos/{user_id}/{video_id}.mp4"

    def rel_thumb_path(self, user_id: str, video_id: str) -> str:
        return f"thumbs/{user_id}/{video_id}.jpg"

    def rel_slide_path(self, user_id: str, video_id: str, i: int, ext: str = "jpg") -> str:
        return f"videos/{user_id}/{video_id}/{i}.{ext}"

    # --- absolute path builders --------------------------------------------
    def video_path(self, user_id: str, video_id: str) -> Path:
        return self.abs_path(self.rel_video_path(user_id, video_id))

    def thumb_path(self, user_id: str, video_id: str) -> Path:
        return self.abs_path(self.rel_thumb_path(user_id, video_id))

    def abs_path(self, rel: str) -> Path:
        """Resolve ``rel`` against ``data_dir`` and confine it there.

        Raises ``ValueError`` if the resulting path escapes ``data_dir``
        (e.g. ``../../etc/passwd`` or an absolute path ``/etc/passwd``).
        """
        base = self.data_dir.resolve()
        candidate = (base / rel).resolve()
        if not candidate.is_relative_to(base):
            raise ValueError(f"path escapes DATA_DIR: {rel!r}")
        return candidate

    # --- startup -----------------------------------------------------------
    def ensure_dirs(self) -> None:
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs_dir.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    """Build :class:`Settings` from the environment, tolerating empty defaults."""
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", ""),
        supabase_service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        supabase_jwt_secret=os.environ.get("SUPABASE_JWT_SECRET", ""),
        media_token_secret=os.environ.get("MEDIA_TOKEN_SECRET", ""),
        data_dir=Path(os.environ.get("DATA_DIR", "/data")),
        ig_cookies_file=os.environ.get("IG_COOKIES_FILE") or None,
        max_video_mb=int(os.environ.get("MAX_VIDEO_MB", "300")),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
