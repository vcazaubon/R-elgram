"""Logique pure des liens de partage : slug, PIN (pbkdf2), expiration, statut.

Aucun accès DB ici — ce module est trivialement testable. Les helpers DB vivent
dans ``supa.py`` ; les routes dans ``main.py``.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time as _time
from typing import Optional

EXPIRES_IN_SECONDS = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}

_PBKDF2_ITER = 120_000


def new_slug() -> str:
    """Capability publique non devinable (~22 car., 128 bits, URL-safe sans '=')."""
    return secrets.token_urlsafe(16)


def hash_password(pin: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, _PBKDF2_ITER)
    return f"pbkdf2_sha256${_PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def verify_password(pin: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


def expires_at_from(code: Optional[str], now: Optional[float] = None) -> Optional[int]:
    """Convertit un preset ('24h'/'7d'/'30d'/None) en epoch d'expiration (None=permanent)."""
    if code is None:
        return None
    if code not in EXPIRES_IN_SECONDS:
        raise ValueError(f"unknown expires_in: {code!r}")
    base = int(now if now is not None else _time.time())
    return base + EXPIRES_IN_SECONDS[code]


def _epoch(value) -> Optional[float]:
    """Normalise un timestamptz (ISO str | epoch | None) en epoch float ou None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    from datetime import datetime
    s = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(s).timestamp()


def share_status(row: dict, now: Optional[float] = None) -> str:
    """'revoked' | 'expired' | 'active' à partir d'une ligne shares."""
    t = now if now is not None else _time.time()
    if _epoch(row.get("revoked_at")) is not None:
        return "revoked"
    exp = _epoch(row.get("expires_at"))
    if exp is not None and exp < t:
        return "expired"
    return "active"


class RateLimiter:
    """Limiteur mémoire simple (fenêtre glissante). Suffisant pour un mono-process."""

    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max = max_attempts
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        t = now if now is not None else _time.time()
        hits = [h for h in self._hits.get(key, []) if h > t - self.window]
        if len(hits) >= self.max:
            self._hits[key] = hits
            return False
        hits.append(t)
        self._hits[key] = hits
        return True
