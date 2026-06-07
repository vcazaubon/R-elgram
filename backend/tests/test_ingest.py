"""Ingestion pipeline tests — yt-dlp, ffmpeg and supa are all mocked.

The pipeline must walk ``videos.status`` fetching -> thumbnailing -> ready,
fill the storage/thumb paths + metadata, and on failure flip to ``error``
without ever propagating an exception.
"""
import pytest

from app import ingest, supa


def _set_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MAX_VIDEO_MB", "300")
    from app.config import get_settings
    get_settings.cache_clear()


def _write_thumb(src, dst):
    """Mimic the real ffmpeg thumbnail step (writes a jpg, creating parents)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(b"\xff\xd8jpeg")


class Recorder:
    """Captures the sequence of update_video(fields) calls."""

    def __init__(self):
        self.updates = []

    def update_video(self, video_id, fields):
        self.updates.append((video_id, dict(fields)))
        return {"id": video_id, **fields}

    @property
    def statuses(self):
        return [f["status"] for _, f in self.updates if "status" in f]

    @property
    def final(self):
        merged = {}
        for _, f in self.updates:
            merged.update(f)
        return merged


async def test_run_ingest_happy_path(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def fake_download(url, dest, cookies, max_mb):
        # simulate yt-dlp writing the video file
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"\x00\x01\x02fakevideo")
        return {
            "title": "Une super vidéo de test\nseconde ligne",
            "uploader_id": "cool.creator",
            "uploader": "Cool Creator",
            "duration": 42,
        }

    def fake_thumbnail(src, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"\xff\xd8\xff\xe0jpeg")

    def fake_color(src):
        return "#123abc"

    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", fake_thumbnail)
    monkeypatch.setattr(ingest, "_dominant_color", fake_color)

    await ingest.run_ingest("vid-1", "user-7", "https://www.instagram.com/reel/abc/")

    assert rec.statuses == ["fetching", "thumbnailing", "ready"]
    final = rec.final
    assert final["status"] == "ready"
    assert final["storage_path"] == "videos/user-7/vid-1.mp4"
    assert final["thumb_path"] == "thumbs/user-7/vid-1.jpg"
    assert final["title"] == "Une super vidéo de test"
    assert final["author"] == "@cool.creator"
    assert final["duration_seconds"] == 42
    assert final["thumb_color"] == "#123abc"
    # files actually written under DATA_DIR
    assert (tmp_path / "videos/user-7/vid-1.mp4").exists()
    assert (tmp_path / "thumbs/user-7/vid-1.jpg").exists()


async def test_run_ingest_title_fallback(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x")
        return {"title": "", "uploader": "", "duration": None}

    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")

    await ingest.run_ingest("vid-2", "user-7", "https://instagram.com/p/xyz/")

    final = rec.final
    assert final["status"] == "ready"
    assert final["title"] == "Sans titre"


async def test_run_ingest_title_truncated(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    long_title = "a" * 200

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x")
        return {"title": long_title, "uploader_id": "u", "duration": 5}

    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")

    await ingest.run_ingest("vid-3", "user-7", "https://instagram.com/p/xyz/")

    assert len(rec.final["title"]) <= 80


async def test_run_ingest_download_error(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def boom(url, dest, cookies, max_mb):
        raise RuntimeError("yt-dlp exploded")

    monkeypatch.setattr(ingest, "_download", boom)

    # must NOT raise
    await ingest.run_ingest("vid-4", "user-7", "https://instagram.com/reel/x/")

    assert "fetching" in rec.statuses
    assert rec.statuses[-1] == "error"
    final = rec.final
    assert final["status"] == "error"
    assert final["error"]  # non-empty message
