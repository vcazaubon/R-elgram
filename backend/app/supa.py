"""Supabase service-role helpers.

NOTE (Phase A): only the token helpers needed by ``auth.py`` are stubbed here so
they exist as a monkeypatch target. The real service-role client and the full
helper set (videos/categories/tokens CRUD) are implemented in Phase B (Task B1).
"""
from __future__ import annotations

from typing import Optional


def find_token(token_hash: str) -> Optional[dict]:
    """Look up an api_tokens row by its sha256 hash. Returns the row or None.

    Real implementation lands in Phase B (Task B1).
    """
    raise NotImplementedError("supa.find_token implemented in Phase B")


def touch_token(token_id: str, iso: str) -> None:
    """Update ``api_tokens.last_used_at``. Best-effort.

    Real implementation lands in Phase B (Task B1).
    """
    raise NotImplementedError("supa.touch_token implemented in Phase B")
