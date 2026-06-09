"""media-url enrichi + route slide/{i} (publications à images)."""
import time

import jwt
from fastapi.testclient import TestClient

JWT_SECRET = "jwt-secret-für-tests-abcdefghijklmnop"
MEDIA_SECRET = "media-secret-für-tests-1234567890abc"


def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", MEDIA_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()


def _client():
    import app.main as main
    return TestClient(main.app)


def _auth(sub="user-1"):
    tok = jwt.encode({"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
                     JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


def _image_row():
    return {
        "id": "vid-img", "user_id": "user-1", "status": "ready",
        "media_type": "image",
        "media": [{"i": 0, "path": "videos/user-1/vid-img/0.jpg"},
                  {"i": 1, "path": "videos/user-1/vid-img/1.jpg"}],
        "storage_path": "videos/user-1/vid-img/0.jpg",
        "thumb_path": "thumbs/user-1/vid-img.jpg",
    }


def test_media_url_image_returns_slides(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-img/media-url", headers=_auth())
    assert r.status_code == 200
    j = r.json()
    assert j["media_type"] == "image"
    assert len(j["slides"]) == 2
    assert "/api/videos/vid-img/slide/0?t=" in j["slides"][0]
    assert j["thumb_url"]


def test_media_url_video_returns_stream(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    row = {"id": "vid-v", "user_id": "user-1", "status": "ready", "media_type": "video",
           "media": None, "storage_path": "videos/user-1/vid-v.mp4", "thumb_path": "thumbs/user-1/vid-v.jpg"}
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(row) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-v/media-url", headers=_auth())
    assert r.status_code == 200
    j = r.json()
    assert j["media_type"] == "video"
    assert "/api/videos/vid-v/stream?t=" in j["stream_url"]


def test_slide_serves_image_bytes(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa, media
    from app.config import get_settings
    p = get_settings().abs_path("videos/user-1/vid-img/0.jpg")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"IMG0")
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    tok = media.sign_media_token("vid-img", "user-1")
    r = _client().get(f"/api/videos/vid-img/slide/0?t={tok}")
    assert r.status_code == 200
    assert r.content == b"IMG0"


def test_slide_out_of_range_404(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa, media
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    tok = media.sign_media_token("vid-img", "user-1")
    r = _client().get(f"/api/videos/vid-img/slide/9?t={tok}")
    assert r.status_code == 404


def test_slide_bad_token_403(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-img/slide/0?t=not.a.valid.token")
    assert r.status_code == 403


def test_slide_webp_content_type(monkeypatch, tmp_path):
    """A .webp slide is served with Content-Type: image/webp."""
    _env(monkeypatch, tmp_path)
    from app import supa, media
    from app.config import get_settings
    webp_row = {
        "id": "vid-webp", "user_id": "user-1", "status": "ready",
        "media_type": "image",
        "media": [{"i": 0, "path": "videos/user-1/vid-webp/0.webp"}],
        "storage_path": "videos/user-1/vid-webp/0.webp",
        "thumb_path": "thumbs/user-1/vid-webp.jpg",
    }
    p = get_settings().abs_path("videos/user-1/vid-webp/0.webp")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"WEBPDATA")
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(webp_row) if user_id in (None, "user-1") else None)
    tok = media.sign_media_token("vid-webp", "user-1")
    r = _client().get(f"/api/videos/vid-webp/slide/0?t={tok}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/webp")
