"""Supabase service-role helpers.

A single service-role client (bypasses RLS) is created lazily on first use so
that the module can be imported without any environment configured (tests
monkeypatch these helpers; the app only needs a live client at runtime).

Helpers cover the rows the backend owns: ``videos``, ``api_tokens`` and a
read-only ``categories`` ownership check. ``user_id`` is always supplied by the
caller from a validated JWT/token (defense in depth on top of RLS).
"""
from __future__ import annotations

from typing import Optional

from .config import get_settings

# Lazily-created singleton service-role client.
_client = None


def get_client():
    """Return the service-role supabase client, creating it on first use."""
    global _client
    if _client is None:
        from supabase import create_client

        settings = get_settings()
        _client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
    return _client


# --- videos -----------------------------------------------------------------

def insert_video(user_id: str, source_url: str, category_id: Optional[str] = None) -> dict:
    """Create a ``videos`` row in ``analyzing`` state and return it."""
    payload = {
        "user_id": user_id,
        "source_url": source_url,
        "category_id": category_id,
        "status": "analyzing",
    }
    res = get_client().table("videos").insert(payload).execute()
    return res.data[0]


def update_video(video_id: str, fields: dict) -> dict:
    """Patch a ``videos`` row by id and return the updated row."""
    res = get_client().table("videos").update(fields).eq("id", video_id).execute()
    return res.data[0] if res.data else {}


def get_video(video_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Fetch a ``videos`` row by id, optionally constrained to ``user_id``."""
    query = get_client().table("videos").select("*").eq("id", video_id)
    if user_id is not None:
        query = query.eq("user_id", user_id)
    res = query.limit(1).execute()
    return res.data[0] if res.data else None


def delete_video(video_id: str, user_id: str) -> None:
    """Delete a ``videos`` row constrained to ``user_id`` (defense in depth)."""
    get_client().table("videos").delete().eq("id", video_id).eq("user_id", user_id).execute()


# --- categories -------------------------------------------------------------

def category_belongs_to_user(category_id: str, user_id: str) -> bool:
    """Return True if ``category_id`` exists and is owned by ``user_id``."""
    res = (
        get_client()
        .table("categories")
        .select("id")
        .eq("id", category_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


# --- api_tokens -------------------------------------------------------------

def find_token(token_hash: str) -> Optional[dict]:
    """Look up an ``api_tokens`` row by its sha256 hash. Returns the row or None."""
    res = (
        get_client()
        .table("api_tokens")
        .select("*")
        .eq("token_hash", token_hash)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def touch_token(token_id: str, iso: str) -> None:
    """Refresh ``api_tokens.last_used_at``. Best-effort."""
    get_client().table("api_tokens").update({"last_used_at": iso}).eq("id", token_id).execute()


def insert_token(user_id: str, token_hash: str, label: str) -> dict:
    """Create an ``api_tokens`` row and return it."""
    payload = {"user_id": user_id, "token_hash": token_hash, "label": label}
    res = get_client().table("api_tokens").insert(payload).execute()
    return res.data[0]


def list_tokens(user_id: str) -> list[dict]:
    """List ``api_tokens`` for ``user_id`` (without the secret)."""
    res = (
        get_client()
        .table("api_tokens")
        .select("id,label,created_at,last_used_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def delete_token(token_id: str, user_id: str) -> None:
    """Delete an ``api_tokens`` row constrained to ``user_id``."""
    get_client().table("api_tokens").delete().eq("id", token_id).eq("user_id", user_id).execute()


# --- shares -----------------------------------------------------------------

def get_video_service(video_id: str) -> Optional[dict]:
    """Fetch a video by id WITHOUT user scoping (pour les chemins publics, après
    résolution d'un share). À n'utiliser qu'avec un video_id issu d'une ligne shares."""
    res = get_client().table("videos").select("*").eq("id", video_id).limit(1).execute()
    return res.data[0] if res.data else None


def insert_share(user_id: str, video_id: str, slug: str,
                 password_hash: Optional[str], expires_at_iso: Optional[str]) -> dict:
    payload = {
        "user_id": user_id, "video_id": video_id, "slug": slug,
        "password_hash": password_hash, "expires_at": expires_at_iso,
    }
    res = get_client().table("shares").insert(payload).execute()
    return res.data[0]


def list_shares_for_video(video_id: str, user_id: str) -> list[dict]:
    res = (get_client().table("shares").select("*")
           .eq("video_id", video_id).eq("user_id", user_id)
           .order("created_at", desc=True).execute())
    return res.data or []


def list_shares_for_user(user_id: str) -> list[dict]:
    """Liens + champs du réel joints, pour la vue globale."""
    res = (get_client().table("shares")
           .select("*, videos(id,title,thumb_color,media_type)")
           .eq("user_id", user_id).order("created_at", desc=True).execute())
    return res.data or []


def get_share_by_slug(slug: str) -> Optional[dict]:
    res = get_client().table("shares").select("*").eq("slug", slug).limit(1).execute()
    return res.data[0] if res.data else None


def revoke_share(share_id: str, user_id: str, iso: str) -> None:
    (get_client().table("shares").update({"revoked_at": iso})
     .eq("id", share_id).eq("user_id", user_id).execute())


def increment_share_view(share_id: str, count: int, iso: str) -> None:
    """Best-effort : pose view_count + last_viewed_at (count = valeur déjà incrémentée)."""
    (get_client().table("shares")
     .update({"view_count": count, "last_viewed_at": iso}).eq("id", share_id).execute())
