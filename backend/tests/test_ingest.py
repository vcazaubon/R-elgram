"""Ingestion pipeline tests — yt-dlp, ffmpeg and supa are all mocked.

The pipeline must walk ``videos.status`` fetching -> thumbnailing -> ready,
fill the storage/thumb paths + metadata, and on failure flip to ``error``
without ever propagating an exception.
"""
import sys
import types
from pathlib import Path

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
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

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
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

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
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

    await ingest.run_ingest("vid-3", "user-7", "https://instagram.com/p/xyz/")

    assert len(rec.final["title"]) <= 80


def _fake_ytdlp(capture):
    """A stand-in ``yt_dlp`` module that records the opts ``_download`` builds
    and simulates a successful download (writes the output file)."""
    mod = types.ModuleType("yt_dlp")

    class FakeYDL:
        def __init__(self, opts):
            capture["opts"] = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download):
            from pathlib import Path
            out = Path(capture["opts"]["outtmpl"])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"fakevideo")
            return {"title": "t"}

    mod.YoutubeDL = FakeYDL
    return mod


# --- cookie file guard: a configured-but-missing cookies file (expired cookies,
#     lost mount, ...) must NOT crash every download with FileNotFoundError.
#     yt-dlp opens ``cookiefile`` eagerly, so we simply don't pass it. ----------

def test_download_skips_missing_cookiefile(monkeypatch, tmp_path):
    capture = {}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ytdlp(capture))

    ingest._download(
        "https://x/reel", tmp_path / "v.mp4", str(tmp_path / "absent.txt"), 300
    )

    assert "cookiefile" not in capture["opts"]


def test_download_uses_existing_cookiefile(monkeypatch, tmp_path):
    capture = {}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ytdlp(capture))
    cookie = tmp_path / "cookies.txt"
    cookie.write_text("# Netscape HTTP Cookie File\n")

    ingest._download("https://x/reel", tmp_path / "v.mp4", str(cookie), 300)

    assert capture["opts"].get("cookiefile") == str(cookie)


def test_download_without_cookies_arg(monkeypatch, tmp_path):
    capture = {}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ytdlp(capture))

    ingest._download("https://x/reel", tmp_path / "v.mp4", None, 300)

    assert "cookiefile" not in capture["opts"]


# --- iOS compatibility: never leave a non-H.264 file on disk -----------------
#     iOS Safari only decodes H.264/HEVC; yt-dlp can pick VP9/AV1 from Instagram
#     which shows a BLACK player on iPhone. The pipeline must normalise to H.264
#     (re-encode) or at least remux to faststart when already H.264.

def test_download_prefers_h264(monkeypatch, tmp_path):
    capture = {}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ytdlp(capture))

    ingest._download("https://x/reel", tmp_path / "v.mp4", None, 300)

    # The format selection must prefer the avc1 (H.264) rendition iOS can play.
    assert "avc1" in capture["opts"]["format"]


def test_ensure_ios_compatible_reencodes_non_h264(monkeypatch, tmp_path):
    monkeypatch.setattr(ingest, "_video_codec", lambda p: "vp9")
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"reencoded")  # simulate ffmpeg writing temp
        return types.SimpleNamespace(returncode=0)

    monkeypatch.setattr(ingest.subprocess, "run", fake_run)
    src = tmp_path / "v.mp4"
    src.write_bytes(b"vp9file")

    ingest._ensure_ios_compatible(src)

    assert "libx264" in captured["cmd"]          # re-encode to H.264
    assert "+faststart" in captured["cmd"]
    assert src.read_bytes() == b"reencoded"      # replaced in place


def test_ensure_ios_compatible_remuxes_when_already_h264(monkeypatch, tmp_path):
    monkeypatch.setattr(ingest, "_video_codec", lambda p: "h264")
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"remuxed")
        return types.SimpleNamespace(returncode=0)

    monkeypatch.setattr(ingest.subprocess, "run", fake_run)
    src = tmp_path / "v.mp4"
    src.write_bytes(b"h264file")

    ingest._ensure_ios_compatible(src)

    assert "libx264" not in captured["cmd"]       # no re-encode
    assert "copy" in captured["cmd"]              # stream-copy remux
    assert "+faststart" in captured["cmd"]        # moov atom to the front


async def test_run_ingest_makes_video_ios_compatible(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"\x00\x01\x02fakevideo")
        return {"title": "t", "duration": 5}

    seen = {}
    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: seen.setdefault("path", p))

    await ingest.run_ingest("vid-9", "user-7", "https://instagram.com/reel/x/")

    assert rec.final["status"] == "ready"
    # the downloaded file was normalised before being marked ready
    assert seen.get("path") == tmp_path / "videos/user-7/vid-9.mp4"


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


# --- titres parlants : helpers de date ---------------------------------------

def test_format_fr_date_iso_datetime():
    assert ingest._format_fr_date("2026-05-12T08:30:00+00:00") == "12 mai 2026"


def test_format_fr_date_date_only():
    assert ingest._format_fr_date("2026-05-12") == "12 mai 2026"


def test_format_fr_date_none():
    assert ingest._format_fr_date(None) is None
    assert ingest._format_fr_date("pas une date") is None


def test_extract_published_at_from_timestamp():
    # epoch 0 = 1970-01-01T00:00:00+00:00
    assert ingest._extract_published_at({"timestamp": 0}).startswith("1970-01-01")


def test_extract_published_at_from_upload_date():
    assert ingest._extract_published_at({"upload_date": "20260512"}).startswith("2026-05-12")


def test_extract_published_at_missing():
    assert ingest._extract_published_at({}) is None
    assert ingest._extract_published_at({"upload_date": "pas-une-date"}) is None


def test_extract_caption_present_is_raw():
    info = {"description": "Recette 🍋\n\n#food #pasta"}
    assert ingest._extract_caption(info) == "Recette 🍋\n\n#food #pasta"


def test_extract_caption_blank_or_missing():
    assert ingest._extract_caption({"description": "   "}) is None
    assert ingest._extract_caption({}) is None


def test_is_synthetic_title_matches_video_by():
    assert ingest._is_synthetic_title("Video by cool.creator", {}) is True
    assert ingest._is_synthetic_title("video by someone", {}) is True


def test_is_synthetic_title_real_title():
    assert ingest._is_synthetic_title("Ma vraie vidéo", {}) is False
    assert ingest._is_synthetic_title("", {}) is False


def test_clean_caption_line_strips_trailing_hashtags():
    line = ingest._clean_caption_line("Recette de pâtes au citron 🍋\n\n#food #pasta")
    assert line == "Recette de pâtes au citron 🍋"


def test_clean_caption_line_picks_first_useful_line():
    assert ingest._clean_caption_line("\n\nVraie ligne ici\nautre") == "Vraie ligne ici"


def test_clean_caption_line_hashtags_or_emoji_only():
    assert ingest._clean_caption_line("#food #pasta #yum") is None
    assert ingest._clean_caption_line("🍝🍋") is None
    assert ingest._clean_caption_line("") is None


def test_clean_caption_line_truncates_at_word_boundary():
    res = ingest._clean_caption_line("mot " * 40)  # ~160 chars
    assert len(res) <= ingest.TITLE_MAX
    assert res.endswith("…")
    assert not res.endswith(" …")  # coupé proprement à un mot


def test_fallback_title_author_and_date():
    info = {"uploader_id": "bob", "upload_date": "20260512"}
    assert ingest._fallback_title(info) == "@bob · 12 mai 2026"


def test_fallback_title_author_only_when_no_date():
    assert ingest._fallback_title({"uploader_id": "bob"}) == "@bob"


def test_fallback_title_none_without_author():
    assert ingest._fallback_title({"upload_date": "20260512"}) is None


def test_resolve_title_prefers_caption():
    info = {
        "title": "Video by cool.creator",
        "description": "Recette de pâtes au citron 🍋\n#food",
        "uploader_id": "cool.creator",
    }
    assert ingest._resolve_title(info) == "Recette de pâtes au citron 🍋"


def test_resolve_title_real_title_when_no_caption():
    info = {"title": "Ma vraie vidéo", "uploader_id": "bob"}
    assert ingest._resolve_title(info) == "Ma vraie vidéo"


def test_resolve_title_fallback_on_synthetic_without_caption():
    info = {"title": "Video by bob", "uploader_id": "bob", "upload_date": "20260512"}
    assert ingest._resolve_title(info) == "@bob · 12 mai 2026"


def test_resolve_title_caption_only_hashtags_falls_through():
    info = {"title": "Video by bob", "description": "#a #b", "uploader_id": "bob"}
    assert ingest._resolve_title(info) == "@bob"


def test_resolve_title_default_when_nothing():
    assert ingest._resolve_title({}) == ingest.DEFAULT_TITLE
