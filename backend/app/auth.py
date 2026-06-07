"""Authentication: Supabase JWT verification + personal-token resolution.

Two auth paths (Design maître §5):
- ``Authorization: Bearer <supabase_jwt>`` — verified with audience
  ``authenticated``. Supabase signs access tokens either with **asymmetric
  signing keys** (ES256/RS256 — the modern default: verified against the project
  JWKS at ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``) or with a **legacy
  symmetric secret** (HS256 — verified against ``SUPABASE_JWT_SECRET``). Both are
  supported; the algorithm is read from the token header and matched to a strict
  whitelist (no ``alg=none`` / algorithm-confusion possible).
- ``X-Reelgram-Token: <token>`` — sha256 looked up in ``api_tokens`` (service
  role). ``last_used_at`` is refreshed best-effort.

Both resolve to a ``user_id`` applied throughout the API.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

import jwt
from jwt import PyJWKClient, PyJWKClientError
from fastapi import HTTPException, Request

from . import supa
from .config import get_settings

JWT_AUDIENCE = "authenticated"
PERSONAL_TOKEN_HEADER = "X-Reelgram-Token"

# Strict algorithm whitelist (prevents alg=none and HS/RS confusion attacks).
_SYMMETRIC_ALGS = {"HS256", "HS384", "HS512"}
_ASYMMETRIC_ALGS = {
    "ES256", "ES384", "ES512",
    "RS256", "RS384", "RS512",
    "PS256", "PS384", "PS512",
    "EdDSA",
}

_jwk_client: Optional[PyJWKClient] = None


def _unauthorized(detail: str = "Unauthorized") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def _get_jwk_client() -> PyJWKClient:
    """Lazily build (and cache) the JWKS client for the project's signing keys."""
    global _jwk_client
    if _jwk_client is None:
        base = get_settings().supabase_url.rstrip("/")
        _jwk_client = PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json")
    return _jwk_client


def verify_jwt(token: str) -> str:
    """Verify a Supabase JWT (asymmetric via JWKS or legacy HS256) → ``sub``.

    Raises ``HTTPException(401)`` on any failure: unsupported algorithm, bad
    signature, wrong audience, missing/expired ``exp``, or missing ``sub``.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid token") from exc

    common = {
        "algorithms": [alg],
        "audience": JWT_AUDIENCE,
        "options": {"require": ["exp", "sub"]},
    }
    try:
        if alg in _SYMMETRIC_ALGS:
            secret = get_settings().supabase_jwt_secret
            if not secret:
                raise _unauthorized("JWT secret not configured")
            payload = jwt.decode(token, secret, **common)
        elif alg in _ASYMMETRIC_ALGS:
            signing_key = _get_jwk_client().get_signing_key_from_jwt(token).key
            payload = jwt.decode(token, signing_key, **common)
        else:
            raise _unauthorized("Unsupported token algorithm")
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, PyJWKClientError) as exc:
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
