"""Pydantic request/response schemas + status→step derivation.

Field names mirror ``supabase/migrations/0001_init.sql`` and
``frontend/src/lib/types.ts`` (notably ``STATUS_STEP``).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

# status -> step (cf. Design maître §5 / frontend types.ts)
STATUS_STEP: dict[str, int] = {
    "analyzing": 0,
    "fetching": 1,
    "thumbnailing": 2,
    "ready": 3,
    "error": -1,
}


def status_to_step(status: str) -> int:
    """Map a video ``status`` to its import-screen step. Unknown -> -1 (error)."""
    return STATUS_STEP.get(status, -1)


class IngestRequest(BaseModel):
    url: str
    category_id: Optional[str] = None


class IngestResponse(BaseModel):
    id: str
    status: str


class IngestStatus(BaseModel):
    status: str
    step: int
    error: Optional[str] = None


class TokenCreate(BaseModel):
    label: Optional[str] = None


class TokenCreated(BaseModel):
    id: str
    token: str


class TokenInfo(BaseModel):
    id: str
    label: str
    created_at: str
    last_used_at: Optional[str] = None


class MediaUrls(BaseModel):
    media_type: str = "video"
    stream_url: Optional[str] = None   # vidéo uniquement
    slides: Optional[list[str]] = None  # post image : URLs signées par slide
    thumb_url: str


class ShareCreate(BaseModel):
    expires_in: Optional[str] = None   # '24h' | '7d' | '30d' | None (permanent)
    password: Optional[str] = None


class ShareCreated(BaseModel):
    id: str
    slug: str
    url: str
    expires_at: Optional[str] = None
    has_password: bool = False


class ShareInfo(BaseModel):
    id: str
    slug: str
    url: str
    status: str                        # active | expired | revoked
    expires_at: Optional[str] = None
    has_password: bool = False
    view_count: int = 0
    created_at: str


class ShareVideoRef(BaseModel):
    id: str
    title: str
    thumb_color: Optional[str] = None
    media_type: str = "video"


class ShareGlobalInfo(ShareInfo):
    video: Optional[ShareVideoRef] = None


class PublicShareMeta(BaseModel):
    media_type: str = "video"
    title: str
    needs_password: bool = False
    expires_at: Optional[str] = None
    stream_url: Optional[str] = None
    slides: Optional[list[str]] = None
    thumb_url: Optional[str] = None


class ShareUnlock(BaseModel):
    password: str
