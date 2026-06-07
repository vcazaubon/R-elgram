"""Authentication: Supabase JWT verification + personal-token resolution.

Two auth paths (Design maître §5):
- ``Authorization: Bearer <supabase_jwt>`` — verified HS256 against
  ``SUPABASE_JWT_SECRET`` with audience ``authenticated``.
- ``X-Reelgram-Token: <token>`` — sha256 looked up in ``api_tokens`` (service
  role). ``last_used_at`` is refreshed best-effort.

Both resolve to a ``user_id`` applied throughout the API.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Request

from . import supa
from .config import get_settings

JWT_AUDIENCE = "authenticated"
PERSONAL_TOKEN_HEADER = "X-Reelgram-Token"


def _unauthorized(detail: str = "Unauthorized") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def verify_jwt(token: str) -> str:
    """Decode a Supabase JWT (HS256) and return its ``sub`` (user_id).

    Raises ``HTTPException(401)`` on any failure: bad signature, wrong
    audience, missing/expired ``exp``, or missing ``sub``.
    """
    secret = get_settings().supabase_jwt_secret
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid token") from exc

    sub = payload.get("sub")
    if not sub:
        raise _unauthorized("Invalid token")
    return sub


def hash_token(token: str) -> str:
    """Stable sha256 hex digest of a personal token plaintext."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("Authorization")
    if not header:
        return None
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None
    return parts[1].strip()


def _resolve_personal_token(token: str) -> str:
    """Resolve a personal token plaintext to a ``user_id``.

    Raises ``HTTPException(401)`` if unknown. Touches ``last_used_at``
    best-effort (failures do not block resolution).
    """
    row = supa.find_token(hash_token(token))
    if not row:
        raise _unauthorized("Invalid token")
    try:
        supa.touch_token(row["id"], datetime.now(timezone.utc).isoformat())
    except Exception:
        pass
    return row["user_id"]


async def resolve_user(request: Request) -> str:
    """FastAPI dependency accepting a Bearer JWT OR an ``X-Reelgram-Token``."""
    bearer = _bearer_token(request)
    if bearer:
        return verify_jwt(bearer)

    personal = request.headers.get(PERSONAL_TOKEN_HEADER)
    if personal:
        return _resolve_personal_token(personal)

    raise _unauthorized("Missing credentials")


async def resolve_user_jwt_only(request: Request) -> str:
    """FastAPI dependency accepting ONLY a Bearer JWT (e.g. /tokens, /media-url)."""
    bearer = _bearer_token(request)
    if not bearer:
        raise _unauthorized("Missing credentials")
    return verify_jwt(bearer)
