import time
import pytest
from app import shares


def test_new_slug_is_urlsafe_and_long():
    s = shares.new_slug()
    assert len(s) >= 20
    assert "/" not in s and "+" not in s and "=" not in s
    assert shares.new_slug() != shares.new_slug()  # aléatoire


def test_password_hash_roundtrip():
    h = shares.hash_password("4821")
    assert h.startswith("pbkdf2_sha256$")
    assert shares.verify_password("4821", h) is True
    assert shares.verify_password("0000", h) is False


def test_verify_password_handles_none():
    assert shares.verify_password("whatever", None) is False


@pytest.mark.parametrize("code,seconds", [("24h", 86400), ("7d", 7 * 86400), ("30d", 30 * 86400)])
def test_expires_at_presets(code, seconds):
    now = 1_000_000
    exp = shares.expires_at_from(code, now=now)
    assert exp == now + seconds


def test_expires_at_permanent_is_none():
    assert shares.expires_at_from(None, now=1_000_000) is None


def test_expires_at_rejects_unknown():
    with pytest.raises(ValueError):
        shares.expires_at_from("99y", now=0)


def test_status_active_expired_revoked():
    now = 2_000
    assert shares.share_status({"expires_at": None, "revoked_at": None}, now=now) == "active"
    assert shares.share_status({"expires_at": now + 10, "revoked_at": None}, now=now) == "active"
    assert shares.share_status({"expires_at": now - 10, "revoked_at": None}, now=now) == "expired"
    assert shares.share_status({"expires_at": None, "revoked_at": now - 1}, now=now) == "revoked"


def test_rate_limiter_blocks_after_max():
    rl = shares.RateLimiter(max_attempts=3, window_seconds=100)
    key = "slug-x:1.2.3.4"
    assert all(rl.allow(key, now=0) for _ in range(3))
    assert rl.allow(key, now=0) is False          # 4e bloqué
    assert rl.allow(key, now=200) is True          # fenêtre écoulée
