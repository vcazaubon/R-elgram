"""Personal API tokens router (`/api/tokens`).

Tokens authenticate the iOS Shortcut's ``X-Reelgram-Token`` calls. Managing
them, however, requires a real session: every route here is guarded by
``resolve_user_jwt_only`` (no personal-token bootstrap). The plaintext token is
returned exactly once on creation; only its sha256 is stored.
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Response

from . import auth, supa
from .models import TokenCreate, TokenCreated, TokenInfo

DEFAULT_LABEL = "Raccourci iOS"

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.get("", response_model=list[TokenInfo])
async def list_tokens(user_id: str = Depends(auth.resolve_user_jwt_only)):
    return supa.list_tokens(user_id)


@router.post("", response_model=TokenCreated, status_code=201)
async def create_token(
    body: TokenCreate,
    user_id: str = Depends(auth.resolve_user_jwt_only),
):
    plaintext = secrets.token_urlsafe(32)
    label = (body.label or "").strip() or DEFAULT_LABEL
    row = supa.insert_token(user_id, auth.hash_token(plaintext), label)
    return TokenCreated(id=row["id"], token=plaintext)


@router.delete("/{token_id}", status_code=204)
async def delete_token(
    token_id: str,
    user_id: str = Depends(auth.resolve_user_jwt_only),
):
    supa.delete_token(token_id, user_id)
    return Response(status_code=204)
