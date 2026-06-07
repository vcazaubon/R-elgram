"""API integration tests (FastAPI TestClient) — supa + ingest task mocked.

Covers the routes of Design maître §5 mounted under /api (DELETE /videos/{id} is
out of scope, Spec 06). yt-dlp/ffmpeg never run: the ingest task is mocked and
supa helpers are monkeypatched.
"""
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
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()
    return tmp_path


@pytest.fixture
def client(env):
    import app.main as main
    return TestClient(main.app)


def _jwt(sub="user-1"):
    return jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
        JWT_SECRET,
        algorithm="HS256",
    )


def _auth(sub="user-1"):
    return {"Authorization": f"Bearer {_jwt(sub)}"}


# --- health -----------------------------------------------------------------

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# --- ingest -----------------------------------------------------------------

def test_ingest_requires_auth(client):
    r = client.post("/api/ingest", json={"url": "https://www.instagram.com/reel/x/"})
    assert r.status_code == 401


def test_ingest_rejects_non_instagram(client):
    r = client.post(
        "/api/ingest",
        json={"url": "https://youtube.com/watch?v=x"},
        headers=_auth(),
    )
    assert r.status_code == 400


def test_ingest_rejects_bad_scheme(client):
    r = client.post(
        "/api/ingest",
        json={"url": "ftp://www.instagram.com/reel/x/"},
        headers=_auth(),
    )
    assert r.status_code == 400


def test_ingest_creates_row_and_schedules(client, monkeypatch):
    import app.main as main
    from app import supa

    created = {}

    def fake_insert(user_id, source_url, category_id=None):
        created.update(user_id=user_id, source_url=source_url, category_id=category_id)
        return {"id": "new-vid", "status": "analyzing"}

    scheduled = {}

    async def fake_run(video_id, user_id, url):
        scheduled.update(video_id=video_id, user_id=user_id, url=url)

    monkeypatch.setattr(supa, "insert_video", fake_insert)
    monkeypatch.setattr(main.ingest, "run_ingest", fake_run)

    r = client.post(
        "/api/ingest",
        json={"url": "https://www.instagram.com/reel/abc/"},
        headers=_auth(sub="user-9"),
    )
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["id"] == "new-vid"
    assert body["status"] == "analyzing"
    assert created["user_id"] == "user-9"
    assert created["source_url"] == "https://www.instagram.com/reel/abc/"


def test_ingest_rejects_foreign_category(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(supa, "category_belongs_to_user", lambda cid, uid: False)
    # insert should never be reached
    monkeypatch.setattr(
        supa, "insert_video",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not insert")),
    )

    r = client.post(
        "/api/ingest",
        json={"url": "https://www.instagram.com/reel/abc/", "category_id": "other-cat"},
        headers=_auth(),
    )
    assert r.status_code == 400


def test_ingest_accepts_own_category(client, monkeypatch):
    import app.main as main
    from app import supa

    monkeypatch.setattr(supa, "category_belongs_to_user", lambda cid, uid: True)
    monkeypatch.setattr(supa, "insert_video", lambda u, s, c=None: {"id": "v", "status": "analyzing"})

    async def fake_run(*a, **k):
        return None

    monkeypatch.setattr(main.ingest, "run_ingest", fake_run)

    r = client.post(
        "/api/ingest",
        json={"url": "https://www.instagram.com/reel/abc/", "category_id": "mine"},
        headers=_auth(),
    )
    assert r.status_code in (200, 201)


# --- ingest status ----------------------------------------------------------

def test_ingest_status(client, monkeypatch):
    from app import supa

    captured = {}

    def fake_get(video_id, user_id=None):
        captured.update(video_id=video_id, user_id=user_id)
        return {"id": video_id, "status": "thumbnailing", "error": None}

    monkeypatch.setattr(supa, "get_video", fake_get)

    r = client.get("/api/ingest/vid-1/status", headers=_auth(sub="owner-1"))
    assert r.status_code == 200
    body = r.json()
    assert body == {"status": "thumbnailing", "step": 2, "error": None}
    # user_id was applied for isolation
    assert captured["user_id"] == "owner-1"


def test_ingest_status_not_found(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: None)
    r = client.get("/api/ingest/nope/status", headers=_auth())
    assert r.status_code == 404


# --- media-url --------------------------------------------------------------

def test_media_url_returns_signed_urls(client, monkeypatch):
    from app import supa, media

    monkeypatch.setattr(
        supa, "get_video",
        lambda vid, user_id=None: {"id": vid, "user_id": user_id, "status": "ready"},
    )

    r = client.get("/api/videos/vid-1/media-url", headers=_auth(sub="owner-1"))
    assert r.status_code == 200
    body = r.json()
    assert "?t=" in body["stream_url"]
    assert "?t=" in body["thumb_url"]
    assert "/api/videos/vid-1/stream" in body["stream_url"]
    assert "/api/videos/vid-1/thumb" in body["thumb_url"]

    # token embedded resolves to this video + user
    tok = body["stream_url"].split("?t=", 1)[1]
    vid, uid = media.verify_media_token(tok)
    assert (vid, uid) == ("vid-1", "owner-1")


def test_media_url_requires_jwt_not_personal_token(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(supa, "find_token", lambda h: {"id": "t", "user_id": "u"})
    r = client.get("/api/videos/vid-1/media-url", headers={"X-Reelgram-Token": "plain"})
    assert r.status_code == 401


def test_media_url_not_found(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: None)
    r = client.get("/api/videos/missing/media-url", headers=_auth())
    assert r.status_code == 404


# --- stream / thumb (media token) -------------------------------------------

def _write_media(tmp_path, user_id, vid):
    from app.config import get_settings
    s = get_settings()
    vp = s.abs_path(s.rel_video_path(user_id, vid))
    tp = s.abs_path(s.rel_thumb_path(user_id, vid))
    vp.parent.mkdir(parents=True, exist_ok=True)
    tp.parent.mkdir(parents=True, exist_ok=True)
    vp.write_bytes(b"VIDEO-CONTENT-1234567890")
    tp.write_bytes(b"\xff\xd8thumb")
    return vp, tp


def test_stream_valid_token(client, env, monkeypatch):
    from app import supa, media

    _write_media(env, "owner-1", "vid-1")
    monkeypatch.setattr(
        supa, "get_video",
        lambda vid, user_id=None: {
            "id": vid, "user_id": "owner-1",
            "storage_path": "videos/owner-1/vid-1.mp4",
            "thumb_path": "thumbs/owner-1/vid-1.jpg",
        },
    )
    tok = media.sign_media_token("vid-1", "owner-1", ttl=60)
    r = client.get(f"/api/videos/vid-1/stream?t={tok}")
    assert r.status_code == 200
    assert r.content == b"VIDEO-CONTENT-1234567890"


def test_stream_range(client, env, monkeypatch):
    from app import supa, media

    _write_media(env, "owner-1", "vid-1")
    monkeypatch.setattr(
        supa, "get_video",
        lambda vid, user_id=None: {
            "id": vid, "user_id": "owner-1",
            "storage_path": "videos/owner-1/vid-1.mp4",
        },
    )
    tok = media.sign_media_token("vid-1", "owner-1", ttl=60)
    r = client.get(f"/api/videos/vid-1/stream?t={tok}", headers={"Range": "bytes=0-4"})
    assert r.status_code == 206
    assert r.headers["Content-Range"].startswith("bytes 0-4/")
    assert r.content == b"VIDEO"


def test_stream_token_for_other_video_forbidden(client, env, monkeypatch):
    from app import supa, media

    _write_media(env, "owner-1", "vid-1")
    monkeypatch.setattr(
        supa, "get_video",
        lambda vid, user_id=None: {
            "id": "vid-1", "user_id": "owner-1",
            "storage_path": "videos/owner-1/vid-1.mp4",
        },
    )
    # token signed for a DIFFERENT video id
    tok = media.sign_media_token("other-vid", "owner-1", ttl=60)
    r = client.get(f"/api/videos/vid-1/stream?t={tok}")
    assert r.status_code == 403


def test_stream_tampered_token_forbidden(client, env, monkeypatch):
    from app import supa, media

    _write_media(env, "owner-1", "vid-1")
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid})
    tok = media.sign_media_token("vid-1", "owner-1", ttl=60)
    r = client.get(f"/api/videos/vid-1/stream?t={tok[:-2]}xy")
    assert r.status_code == 403


def test_thumb_valid_token(client, env, monkeypatch):
    from app import supa, media

    _write_media(env, "owner-1", "vid-1")
    monkeypatch.setattr(
        supa, "get_video",
        lambda vid, user_id=None: {
            "id": vid, "user_id": "owner-1",
            "thumb_path": "thumbs/owner-1/vid-1.jpg",
        },
    )
    tok = media.sign_media_token("vid-1", "owner-1", ttl=60)
    r = client.get(f"/api/videos/vid-1/thumb?t={tok}")
    assert r.status_code == 200
    assert r.content == b"\xff\xd8thumb"


# --- tokens -----------------------------------------------------------------

def test_create_token_returns_plaintext_once(client, monkeypatch):
    from app import supa, auth

    stored = {}

    def fake_insert(user_id, token_hash, label):
        stored.update(user_id=user_id, token_hash=token_hash, label=label)
        return {"id": "tok-1", "label": label}

    monkeypatch.setattr(supa, "insert_token", fake_insert)

    r = client.post("/api/tokens", json={"label": "iPhone"}, headers=_auth(sub="u-5"))
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["id"] == "tok-1"
    assert body["token"]  # plaintext present
    # stored hash matches the plaintext that was returned
    assert stored["token_hash"] == auth.hash_token(body["token"])
    assert stored["user_id"] == "u-5"
    assert stored["label"] == "iPhone"


def test_create_token_default_label(client, monkeypatch):
    from app import supa

    captured = {}
    monkeypatch.setattr(
        supa, "insert_token",
        lambda u, h, label: captured.update(label=label) or {"id": "t", "label": label},
    )
    r = client.post("/api/tokens", json={}, headers=_auth())
    assert r.status_code in (200, 201)
    assert captured["label"]  # a non-empty default label


def test_list_tokens_no_secret(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(
        supa, "list_tokens",
        lambda uid: [
            {"id": "t1", "label": "A", "created_at": "2026-01-01", "last_used_at": None},
        ],
    )
    r = client.get("/api/tokens", headers=_auth())
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["id"] == "t1"
    assert "token" not in rows[0]
    assert "token_hash" not in rows[0]


def test_list_tokens_requires_jwt(client, monkeypatch):
    from app import supa

    monkeypatch.setattr(supa, "find_token", lambda h: {"id": "t", "user_id": "u"})
    r = client.get("/api/tokens", headers={"X-Reelgram-Token": "plain"})
    assert r.status_code == 401


def test_delete_token_filtered_by_user(client, monkeypatch):
    from app import supa

    captured = {}
    monkeypatch.setattr(
        supa, "delete_token",
        lambda tid, uid: captured.update(token_id=tid, user_id=uid),
    )
    r = client.delete("/api/tokens/tok-1", headers=_auth(sub="owner-2"))
    assert r.status_code == 204
    assert captured == {"token_id": "tok-1", "user_id": "owner-2"}
