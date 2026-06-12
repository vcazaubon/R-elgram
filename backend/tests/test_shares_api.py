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


def _ready_share_row(slug="abc", password_hash=None, expires_at=None, revoked_at=None):
    return {"id": "sh1", "slug": slug, "user_id": "owner-1", "video_id": "v1",
            "password_hash": password_hash, "expires_at": expires_at,
            "revoked_at": revoked_at, "view_count": 0}


def test_public_resolve_no_password_returns_token_and_urls(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Mon réel", "media_type": "video", "status": "ready"})
    monkeypatch.setattr(supa, "increment_share_view", lambda *a, **k: None)
    r = client.get("/api/share/abc")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Mon réel"
    assert body["needs_password"] is False
    assert "?t=" in body["stream_url"] and "/api/share/abc/stream" in body["stream_url"]


def test_public_resolve_with_password_hides_token(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(password_hash="pbkdf2_sha256$1$aa$bb"))
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Secret", "media_type": "video", "status": "ready"})
    monkeypatch.setattr(supa, "increment_share_view", lambda *a, **k: None)
    r = client.get("/api/share/abc")
    assert r.status_code == 200
    body = r.json()
    assert body["needs_password"] is True
    assert body.get("stream_url") is None and body.get("slides") is None


def test_public_resolve_expired_410(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(expires_at="2000-01-01T00:00:00+00:00"))
    r = client.get("/api/share/abc")
    assert r.status_code == 410


def test_public_resolve_unknown_slug_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: None)
    assert client.get("/api/share/nope").status_code == 404


def test_public_unlock_success_then_fail(client, monkeypatch):
    from app import supa, shares
    pw_hash = shares.hash_password("4821")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(password_hash=pw_hash))
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "S", "media_type": "video", "status": "ready"})
    ok = client.post("/api/share/abc/unlock", json={"password": "4821"})
    assert ok.status_code == 200 and "?t=" in ok.json()["stream_url"]
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(slug="zzz1", password_hash=pw_hash))
    assert client.post("/api/share/zzz1/unlock", json={"password": "0000"}).status_code == 403


def test_public_unlock_rate_limited(client, monkeypatch):
    from app import supa, shares
    pw_hash = shares.hash_password("4821")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(slug="rl1", password_hash=pw_hash))
    codes = [client.post("/api/share/rl1/unlock", json={"password": "0000"}).status_code for _ in range(6)]
    assert codes[:5] == [403, 403, 403, 403, 403]
    assert codes[5] == 429


def test_public_stream_serves_media(client, env, monkeypatch):
    from app import supa, media
    from app.config import get_settings
    s = get_settings()
    p = s.abs_path("videos/owner-1/v1.mp4"); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"PUBLIC-VIDEO-BYTES")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "storage_path": "videos/owner-1/v1.mp4", "status": "ready"})
    tok = media.sign_share_token("abc", ttl=60)
    r = client.get(f"/api/share/abc/stream?t={tok}")
    assert r.status_code == 200 and r.content == b"PUBLIC-VIDEO-BYTES"


def test_public_stream_token_for_other_slug_forbidden(client, env, monkeypatch):
    from app import supa, media
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    tok = media.sign_share_token("other-slug", ttl=60)
    assert client.get(f"/api/share/abc/stream?t={tok}").status_code == 403


def test_public_og_thumb_no_password(client, env, monkeypatch):
    from app import supa
    from app.config import get_settings
    s = get_settings()
    tp = s.abs_path("thumbs/owner-1/v1.jpg"); tp.parent.mkdir(parents=True, exist_ok=True)
    tp.write_bytes(b"\xff\xd8thumb")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "thumb_path": "thumbs/owner-1/v1.jpg", "status": "ready"})
    r = client.get("/api/share/abc/og")
    assert r.status_code == 200 and r.content == b"\xff\xd8thumb"


def test_public_og_protected_share_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(password_hash="pbkdf2_sha256$1$aa$bb"))
    assert client.get("/api/share/abc/og").status_code == 404
