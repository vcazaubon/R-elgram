"""DELETE /api/videos/{id} tests (Spec 06) — complete purge.

Covers the full delete contract: 204 + purge of file + thumbnail + row;
ownership control (other user -> 404); idempotency (missing files still 204);
auth required (401); in-flight ingest cancelled when status != 'ready'. Plus a
unit test for ``ingest.cancel_ingest``. supa is monkeypatched, DATA_DIR points
at a tmp dir, files are written/checked on the real (tmp) filesystem.
"""
import asyncio
import time

import jwt
import pytest
from fastapi.testclient import TestClient

JWT_SECRET = "jwt-secret-für-tests-abcdefghijklmnop"
MEDIA_SECRET = "media-secret-für-tests-1234567890abc"

VID = "vid-del-1"
OWNER = "owner-1"
STORAGE_PATH = f"videos/{OWNER}/{VID}.mp4"
THUMB_PATH = f"thumbs/{OWNER}/{VID}.jpg"


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


def _jwt(sub=OWNER):
    return jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
        JWT_SECRET,
        algorithm="HS256",
    )


def _auth(sub=OWNER):
    return {"Authorization": f"Bearer {_jwt(sub)}"}


@pytest.fixture
def tmp_files(env):
    """Write the video + thumbnail under DATA_DIR; return their absolute paths."""
    from app.config import get_settings
    s = get_settings()
    vp = s.abs_path(STORAGE_PATH)
    tp = s.abs_path(THUMB_PATH)
    vp.parent.mkdir(parents=True, exist_ok=True)
    tp.parent.mkdir(parents=True, exist_ok=True)
    vp.write_bytes(b"VIDEO-CONTENT")
    tp.write_bytes(b"\xff\xd8thumb")
    return vp, tp


def _row(status="ready"):
    return {
        "id": VID,
        "user_id": OWNER,
        "storage_path": STORAGE_PATH,
        "thumb_path": THUMB_PATH,
        "status": status,
    }


def _patch_supa(monkeypatch, *, row=None, deleted=None):
    """Wire supa.get_video (returns ``row`` for the owner else None) + delete_video."""
    from app import supa

    def fake_get(video_id, user_id=None):
        if row is None:
            return None
        if user_id is not None and user_id != row["user_id"]:
            return None
        return dict(row)

    def fake_delete(video_id, user_id):
        if deleted is not None:
            deleted.update(video_id=video_id, user_id=user_id)

    monkeypatch.setattr(supa, "get_video", fake_get)
    monkeypatch.setattr(supa, "delete_video", fake_delete)


# --- endpoint tests ---------------------------------------------------------

def test_delete_purges_row_file_thumb(client, tmp_files, monkeypatch):
    video_file, thumb_file = tmp_files
    deleted = {}
    _patch_supa(monkeypatch, row=_row(), deleted=deleted)

    r = client.delete(f"/api/videos/{VID}", headers=_auth())

    assert r.status_code == 204
    assert not video_file.exists()
    assert not thumb_file.exists()
    assert deleted == {"video_id": VID, "user_id": OWNER}


def test_delete_other_user_404(client, tmp_files, monkeypatch):
    video_file, thumb_file = tmp_files
    deleted = {}
    _patch_supa(monkeypatch, row=_row(), deleted=deleted)

    r = client.delete(f"/api/videos/{VID}", headers=_auth(sub="someone-else"))

    assert r.status_code == 404
    # nothing purged for a foreign user
    assert video_file.exists()
    assert thumb_file.exists()
    assert deleted == {}


def test_delete_idempotent_missing_files(client, env, monkeypatch):
    # No tmp_files fixture -> the files never existed on disk.
    deleted = {}
    _patch_supa(monkeypatch, row=_row(), deleted=deleted)

    r = client.delete(f"/api/videos/{VID}", headers=_auth())

    assert r.status_code == 204
    assert deleted == {"video_id": VID, "user_id": OWNER}


def test_delete_requires_auth(client, monkeypatch):
    _patch_supa(monkeypatch, row=_row())
    r = client.delete(f"/api/videos/{VID}")
    assert r.status_code == 401


def test_cancel_ingest_called_when_not_ready(client, tmp_files, monkeypatch):
    import app.main as main

    _patch_supa(monkeypatch, row=_row(status="fetching"))

    cancelled = []
    monkeypatch.setattr(main.ingest, "cancel_ingest", lambda vid: cancelled.append(vid))

    r = client.delete(f"/api/videos/{VID}", headers=_auth())

    assert r.status_code == 204
    assert cancelled == [VID]


def test_cancel_ingest_not_called_when_ready(client, tmp_files, monkeypatch):
    import app.main as main

    _patch_supa(monkeypatch, row=_row(status="ready"))

    cancelled = []
    monkeypatch.setattr(main.ingest, "cancel_ingest", lambda vid: cancelled.append(vid))

    r = client.delete(f"/api/videos/{VID}", headers=_auth())

    assert r.status_code == 204
    assert cancelled == []


# --- ingest.cancel_ingest unit test -----------------------------------------

async def test_cancel_ingest_cancels_and_unregisters(monkeypatch):
    from app import ingest

    started = asyncio.Event()

    async def long_task():
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(long_task())
    await started.wait()
    ingest._register_ingest("vid-x", task)
    assert "vid-x" in ingest._ingest_tasks

    ingest.cancel_ingest("vid-x")

    assert task.cancelled() or task.cancelling()
    # registry entry removed
    assert "vid-x" not in ingest._ingest_tasks

    with pytest.raises(asyncio.CancelledError):
        await task


def test_cancel_ingest_noop_when_absent():
    from app import ingest
    # must not raise for an unknown video id
    ingest.cancel_ingest("does-not-exist")


def test_delete_purges_image_slides(client, env, monkeypatch):
    from app.config import get_settings
    s = get_settings()
    rels = ["videos/owner-1/vid-c/0.jpg", "videos/owner-1/vid-c/1.jpg"]
    thumb = "thumbs/owner-1/vid-c.jpg"
    for rel in rels + [thumb]:
        p = s.abs_path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    row = {
        "id": "vid-c", "user_id": "owner-1", "status": "ready",
        "media_type": "image",
        "media": [{"i": 0, "path": rels[0]}, {"i": 1, "path": rels[1]}],
        "storage_path": rels[0], "thumb_path": thumb,
    }
    _patch_supa(monkeypatch, row=row, deleted={})

    r = client.delete("/api/videos/vid-c", headers=_auth())

    assert r.status_code == 204
    for rel in rels + [thumb]:
        assert not s.abs_path(rel).exists()
    # The per-post slide directory must also be removed.
    assert not s.abs_path("videos/owner-1/vid-c").exists()


def test_delete_video_does_not_remove_shared_user_dir(client, env, monkeypatch):
    """Deleting a VIDEO post must not rmdir the shared videos/<user>/ directory."""
    from app.config import get_settings
    s = get_settings()
    # Create the video being deleted and a sibling file owned by the same user.
    vid_rel = "videos/owner-1/vid-v.mp4"
    other_rel = "videos/owner-1/other.mp4"
    thumb_rel = "thumbs/owner-1/vid-v.jpg"
    for rel in [vid_rel, other_rel, thumb_rel]:
        p = s.abs_path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    row = {
        "id": "vid-v", "user_id": "owner-1", "status": "ready",
        "media_type": "video",
        "media": None,
        "storage_path": vid_rel, "thumb_path": thumb_rel,
    }
    _patch_supa(monkeypatch, row=row, deleted={})

    r = client.delete("/api/videos/vid-v", headers=_auth())

    assert r.status_code == 204
    # The deleted video's file is gone, but the shared directory stays because
    # another video (other.mp4) still lives there.
    assert not s.abs_path(vid_rel).exists()
    assert s.abs_path("videos/owner-1").exists(), \
        "shared videos/owner-1/ directory must NOT be removed for a video post"
