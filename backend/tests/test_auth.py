import time

import jwt
import pytest
from fastapi import HTTPException

from app import auth, supa

SECRET = "jwt-secret-für-tests-abcdefghijklmnop"


def _set_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    from app.config import get_settings
    get_settings.cache_clear()


def _make_jwt(sub="user-123", aud="authenticated", with_exp=True, secret=SECRET):
    payload = {"sub": sub, "aud": aud}
    if with_exp:
        payload["exp"] = int(time.time()) + 60
    return jwt.encode(payload, secret, algorithm="HS256")


class FakeRequest:
    def __init__(self, headers):
        from starlette.datastructures import Headers
        self.headers = Headers(headers)


# --- verify_jwt --------------------------------------------------------------

def test_verify_jwt_valid(monkeypatch):
    _set_secret(monkeypatch)
    assert auth.verify_jwt(_make_jwt(sub="abc")) == "abc"


def test_verify_jwt_bad_signature(monkeypatch):
    _set_secret(monkeypatch)
    tok = _make_jwt(secret="wrong-secret-xxxxxxxxxxxxxxxxxxxxxxx")
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(tok)
    assert exc.value.status_code == 401


def test_verify_jwt_bad_audience(monkeypatch):
    _set_secret(monkeypatch)
    tok = _make_jwt(aud="some-other-aud")
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(tok)
    assert exc.value.status_code == 401


def test_verify_jwt_missing_exp(monkeypatch):
    _set_secret(monkeypatch)
    tok = _make_jwt(with_exp=False)
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(tok)
    assert exc.value.status_code == 401


def test_verify_jwt_rejects_alg_none(monkeypatch):
    _set_secret(monkeypatch)
    tok = jwt.encode({"sub": "x", "aud": "authenticated"}, "", algorithm="none")
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(tok)
    assert exc.value.status_code == 401


def test_verify_jwt_es256_via_jwks(monkeypatch):
    """Modern Supabase: access tokens signed ES256, verified against the JWKS."""
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(
        {"sub": "es-user", "aud": "authenticated", "exp": int(time.time()) + 60},
        priv,
        algorithm="ES256",
    )

    class _FakeSigningKey:
        key = priv.public_key()

    class _FakeJWKClient:
        def get_signing_key_from_jwt(self, _token):
            return _FakeSigningKey()

    monkeypatch.setattr(auth, "_get_jwk_client", lambda: _FakeJWKClient())
    assert auth.verify_jwt(token) == "es-user"


def test_verify_jwt_es256_wrong_key_rejected(monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    other_pub = ec.generate_private_key(ec.SECP256R1()).public_key()
    token = jwt.encode(
        {"sub": "es-user", "aud": "authenticated", "exp": int(time.time()) + 60},
        priv,
        algorithm="ES256",
    )

    class _FakeSigningKey:
        key = other_pub

    class _FakeJWKClient:
        def get_signing_key_from_jwt(self, _token):
            return _FakeSigningKey()

    monkeypatch.setattr(auth, "_get_jwk_client", lambda: _FakeJWKClient())
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(token)
    assert exc.value.status_code == 401


# --- hash_token --------------------------------------------------------------

def test_hash_token_stable():
    import hashlib
    h = auth.hash_token("my-token")
    assert h == hashlib.sha256(b"my-token").hexdigest()
    assert auth.hash_token("my-token") == h  # stable
    assert auth.hash_token("other") != h


# --- resolve_user ------------------------------------------------------------

async def test_resolve_user_via_personal_token(monkeypatch):
    _set_secret(monkeypatch)
    touched = {}

    def fake_find_token(token_hash):
        assert token_hash == auth.hash_token("plain-tok")
        return {"id": "tok-1", "user_id": "owner-9"}

    def fake_touch_token(token_id, iso):
        touched["id"] = token_id

    monkeypatch.setattr(supa, "find_token", fake_find_token)
    monkeypatch.setattr(supa, "touch_token", fake_touch_token)

    req = FakeRequest({"X-Reelgram-Token": "plain-tok"})
    assert await auth.resolve_user(req) == "owner-9"
    assert touched["id"] == "tok-1"


async def test_resolve_user_via_jwt(monkeypatch):
    _set_secret(monkeypatch)
    req = FakeRequest({"Authorization": f"Bearer {_make_jwt(sub='jwt-user')}"})
    assert await auth.resolve_user(req) == "jwt-user"


async def test_resolve_user_unknown_token(monkeypatch):
    _set_secret(monkeypatch)
    monkeypatch.setattr(supa, "find_token", lambda token_hash: None)
    req = FakeRequest({"X-Reelgram-Token": "nope"})
    with pytest.raises(HTTPException) as exc:
        await auth.resolve_user(req)
    assert exc.value.status_code == 401


async def test_resolve_user_no_header(monkeypatch):
    _set_secret(monkeypatch)
    req = FakeRequest({})
    with pytest.raises(HTTPException) as exc:
        await auth.resolve_user(req)
    assert exc.value.status_code == 401


async def test_resolve_user_jwt_only_rejects_personal_token(monkeypatch):
    _set_secret(monkeypatch)
    monkeypatch.setattr(supa, "find_token", lambda token_hash: {"id": "t", "user_id": "u"})
    req = FakeRequest({"X-Reelgram-Token": "plain-tok"})
    with pytest.raises(HTTPException) as exc:
        await auth.resolve_user_jwt_only(req)
    assert exc.value.status_code == 401


async def test_resolve_user_jwt_only_accepts_jwt(monkeypatch):
    _set_secret(monkeypatch)
    req = FakeRequest({"Authorization": f"Bearer {_make_jwt(sub='jwt-user')}"})
    assert await auth.resolve_user_jwt_only(req) == "jwt-user"
