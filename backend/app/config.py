"""Application settings + path helpers.

Settings are loaded from the environment (Design maître §6). Paths inside
``DATA_DIR`` are resolved and confined via :meth:`Settings.abs_path` so that no
caller can escape the storage root (defense in depth against path traversal).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional


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
