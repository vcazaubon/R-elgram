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
