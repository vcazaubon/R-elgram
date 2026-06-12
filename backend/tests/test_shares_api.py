import time
import jwt
import pytest
from fastapi.testclient import TestClient

JWT_SECRET = "jwt-secret-für-tests-abcdefghijklmnop"
MEDIA_SECRET = "media-secret-für-tests-1234567890abc"


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", MEDIA_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://reelgram.test")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()
    return tmp_path


@pytest.fixture
def client(env):
    import app.main as main
    return TestClient(main.app)


def _auth(sub="user-1"):
    tok = jwt.encode({"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
                     JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


def test_create_share_requires_ready_video(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "fetching"})
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"}, headers=_auth())
    assert r.status_code == 400


def test_create_share_unknown_video_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: None)
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"}, headers=_auth())
    assert r.status_code == 404


def test_create_share_returns_url_and_persists(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "ready"})
    captured = {}

    def fake_insert(user_id, video_id, slug, password_hash, expires_at_iso):
        captured.update(user_id=user_id, video_id=video_id, slug=slug,
                        password_hash=password_hash, expires_at_iso=expires_at_iso)
        return {"id": "sh1", "slug": slug, "expires_at": expires_at_iso}

    monkeypatch.setattr(supa, "insert_share", fake_insert)
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d", "password": "1234"},
                    headers=_auth(sub="owner-9"))
    assert r.status_code == 201
    body = r.json()
    assert body["url"].startswith("https://reelgram.test/s/")
    assert body["has_password"] is True
    assert captured["user_id"] == "owner-9"
    assert captured["password_hash"] and captured["password_hash"].startswith("pbkdf2_sha256$")
    assert captured["expires_at_iso"] is not None


def test_create_share_permanent_no_password(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "ready"})
    monkeypatch.setattr(supa, "insert_share",
                        lambda u, v, slug, ph, exp: {"id": "sh", "slug": slug, "expires_at": exp})
    r = client.post("/api/videos/v1/shares", json={"expires_in": None}, headers=_auth())
    assert r.status_code == 201
    assert r.json()["expires_at"] is None
    assert r.json()["has_password"] is False


def test_list_shares_for_video(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "list_shares_for_video", lambda vid, uid: [
        {"id": "s1", "slug": "abc", "expires_at": None, "revoked_at": None,
         "password_hash": None, "view_count": 3, "created_at": "2026-06-12"},
    ])
    r = client.get("/api/videos/v1/shares", headers=_auth())
    assert r.status_code == 200
    row = r.json()[0]
    assert row["status"] == "active"
    assert row["has_password"] is False
    assert row["url"].endswith("/s/abc")
    assert "password_hash" not in row


def test_list_shares_global(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "list_shares_for_user", lambda uid: [
        {"id": "s1", "slug": "abc", "expires_at": None, "revoked_at": None,
         "password_hash": "x", "view_count": 0, "created_at": "2026-06-12",
         "videos": {"id": "v1", "title": "T", "thumb_color": "#fff", "media_type": "video"}},
    ])
    r = client.get("/api/shares", headers=_auth())
    assert r.status_code == 200
    row = r.json()[0]
    assert row["video"]["title"] == "T"
    assert row["has_password"] is True


def test_revoke_share(client, monkeypatch):
    from app import supa
    captured = {}
    monkeypatch.setattr(supa, "revoke_share",
                        lambda sid, uid, iso: captured.update(sid=sid, uid=uid))
    r = client.delete("/api/shares/sh-1", headers=_auth(sub="owner-2"))
    assert r.status_code == 204
    assert captured == {"sid": "sh-1", "uid": "owner-2"}


def test_create_share_requires_auth(client):
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"})
    assert r.status_code == 401


def test_create_share_invalid_expires_in(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "ready"})
    r = client.post("/api/videos/v1/shares", json={"expires_in": "99y"}, headers=_auth())
    assert r.status_code == 400
