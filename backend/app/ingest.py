"""Async ingestion pipeline: yt-dlp download + ffmpeg thumbnail + metadata.

The pipeline walks ``videos.status`` through ``fetching`` -> ``thumbnailing`` ->
``ready`` (writing each transition via :func:`supa.update_video`). Any failure
flips the row to ``error`` with a short message and is swallowed (no exception
escapes ``run_ingest`` — the row status is the source of truth, cf. spec §"Erreurs").

External binaries (yt-dlp, ffmpeg) live in private helpers so tests can mock them.
"""
from __future__ import annotations

import asyncio
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from . import supa
from .config import get_settings

_LOG = logging.getLogger(__name__)

DEFAULT_TITLE = "Sans titre"
TITLE_MAX = 80
FALLBACK_COLOR = "#a78bfa"


# --- in-flight task registry ------------------------------------------------
# Maps a ``video_id`` to its running ingest ``asyncio.Task`` so Spec 06's
# DELETE can cancel a job still in flight (avoids an orphan file being rewritten
# after the row + files are purged). Entries are removed when the task finishes.
_ingest_tasks: dict[str, "asyncio.Task"] = {}


def _register_ingest(video_id: str, task: "asyncio.Task") -> None:
    """Record an in-flight ingest task and auto-remove it when it completes."""
    _ingest_tasks[video_id] = task
    task.add_done_callback(lambda _t, vid=video_id: _ingest_tasks.pop(vid, None))


def cancel_ingest(video_id: str) -> None:
    """Cancel the in-flight ingest task for ``video_id`` and drop it from the
    registry. No-op if no task is registered (already finished or never ran)."""
    task = _ingest_tasks.pop(video_id, None)
    if task is not None and not task.done():
        task.cancel()


# --- external binaries (mocked in tests) ------------------------------------

def _download(url: str, dest: Path, cookies: Optional[str], max_mb: int) -> dict:
    """Download ``url`` to ``dest`` (mp4) via yt-dlp, returning the info dict."""
    import yt_dlp

    dest.parent.mkdir(parents=True, exist_ok=True)
    opts = {
        # Prefer the H.264 (avc1) + AAC (mp4a) rendition Instagram serves: iOS
        # Safari only decodes H.264/HEVC, so picking the "best" stream blindly
        # could grab VP9/AV1 → black player on iPhone. Falls back to any stream
        # when no avc1 rendition exists; _ensure_ios_compatible re-encodes those.
        "format": "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(dest),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": max_mb * 1024 * 1024,
    }
    # Only hand yt-dlp a cookies file that actually exists. yt-dlp opens
    # ``cookiefile`` eagerly, so a configured-but-missing path (expired cookies,
    # a lost bind mount, ...) would raise FileNotFoundError on EVERY download.
    # Degrade gracefully instead: public Reels still work without cookies; only
    # private/age-gated ones fail — and with a clearer error than [Errno 2].
    if cookies and Path(cookies).exists():
        opts["cookiefile"] = cookies
    elif cookies:
        _LOG.warning("IG cookies file %r introuvable — téléchargement sans cookies", cookies)

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return info or {}


# Extensions considérées comme des images (le reste = vidéo, on les ignore).
_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "heic"}


def _looks_like_image_post_url(url: str) -> bool:
    """True si l'URL PEUT porter des images (post ``/p/``).

    Les Reels / IGTV sont toujours des vidéos → on saute gallery-dl pour eux.
    Tout le reste (``/p/`` ou forme inconnue) est tenté en extraction image,
    avec repli vidéo si aucune image n'en sort (cf. ``run_ingest``).
    """
    try:
        path = (urlparse(url).path or "").lower()
    except Exception:
        return False
    return not ("/reel/" in path or "/reels/" in path or "/tv/" in path)


def _extract_post(url: str, cookies: Optional[str]) -> dict:
    """Classe un post Instagram via ``gallery-dl -j`` (extraction SANS download).

    Renvoie ``{"slides": [{"url","ext","kind","width","height"}, …], "meta": {…}}``.
    ``gallery-dl -j`` sérialise une liste de messages ; chaque message
    ``[3, url, metadata]`` (``Message.Url``) décrit un média. ``kind`` vaut
    ``"image"`` quand l'extension est dans :data:`_IMAGE_EXTS`, sinon ``"video"``.
    Helper isolé (subprocess) pour être mocké en test, comme yt-dlp/ffmpeg.
    """
    import json

    cmd = ["gallery-dl", "-j"]
    if cookies and Path(cookies).exists():
        cmd += ["--cookies", cookies]
    cmd.append(url)
    out = subprocess.run(
        cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ).stdout
    data = json.loads(out.decode("utf-8", "ignore") or "[]")

    slides: list[dict] = []
    meta: dict = {}
    for item in data:
        if not (isinstance(item, list) and len(item) >= 3 and item[0] == 3):
            continue
        media_url, kw = item[1], item[2]
        if not isinstance(kw, dict):
            kw = {}
        if not meta:
            meta = kw
        ext = str(kw.get("extension", "")).lower()
        kind = "image" if ext in _IMAGE_EXTS else "video"
        slides.append({
            "url": media_url,
            "ext": ext or "jpg",
            "kind": kind,
            "width": kw.get("width"),
            "height": kw.get("height"),
        })
    return {"slides": slides, "meta": meta}


def _download_image(url: str, dest: Path) -> None:
    """Télécharge une image (slide de carrousel) vers ``dest`` via httpx.

    Les URLs d'images du CDN Instagram sont publiques (signées en query) →
    pas besoin de cookies ici. Helper isolé pour être mocké en test.
    """
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


def _post_meta_to_info(meta: dict) -> dict:
    """Adapte les métadonnées gallery-dl au format ``info`` (yt-dlp) attendu par
    les extracteurs de titre/auteur/légende existants (DRY)."""
    return {
        "description": meta.get("description") or "",
        "uploader_id": meta.get("username"),
        "uploader": meta.get("fullname"),
        "title": "",
    }


def _published_at_from_gallery(meta: dict) -> Optional[str]:
    """Convertit la date gallery-dl (``"YYYY-MM-DD HH:MM:SS"``) en ISO-8601 UTC.

    Naïf → traité comme UTC. Toute valeur illisible → None.
    """
    raw = meta.get("date")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = datetime.fromisoformat(raw.replace(" ", "T"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _video_codec(path: Path) -> Optional[str]:
    """Return the first video stream's codec name (``h264``/``vp9``/…) or None."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1",
                str(path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ).stdout.decode("utf-8", "ignore").strip()
        return out or None
    except Exception:
        return None


def _ensure_ios_compatible(path: Path) -> None:
    """Guarantee ``path`` plays on iOS Safari: H.264 video + faststart moov atom.

    iOS only decodes H.264/HEVC, but yt-dlp may still pick VP9/AV1 from Instagram
    (a black player on iPhone — cf. the systematic-debugging session). When the
    video stream is already H.264 we just stream-copy to move the moov atom to
    the front (cheap); otherwise we re-encode the video to H.264. Audio is
    normalised to AAC. The result replaces the original in place.
    """
    codec = _video_codec(path)
    tmp = path.with_suffix(".ios.mp4")
    if codec == "h264":
        cmd = [
            "ffmpeg", "-y", "-i", str(path),
            "-c", "copy", "-movflags", "+faststart", str(tmp),
        ]
    else:
        cmd = [
            "ffmpeg", "-y", "-i", str(path),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-movflags", "+faststart", str(tmp),
        ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tmp.replace(path)


def _thumbnail(src: Path, dst: Path, seek: bool = True) -> None:
    """Extrait une frame de ``src`` vers ``dst`` (jpeg 640px) via ffmpeg.

    ``seek=True`` (défaut, vidéo) saute ~1 s avant la capture ; ``seek=False``
    (image fixe) capture l'unique frame sans seek (sinon ffmpeg échoue).
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y"]
    if seek:
        cmd += ["-ss", "1"]
    cmd += ["-i", str(src), "-frames:v", "1", "-vf", "scale=640:-1", str(dst)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _dominant_color(src: Path) -> str:
    """Return the average color of ``src`` as ``#rrggbb`` (fallback on any error)."""
    try:
        out = subprocess.run(
            [
                "ffmpeg", "-i", str(src), "-vf", "scale=1:1", "-frames:v", "1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ).stdout
        if len(out) >= 3:
            r, g, b = out[0], out[1], out[2]
            return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        pass
    return FALLBACK_COLOR


# --- metadata extraction ----------------------------------------------------

def _extract_author(info: dict) -> Optional[str]:
    handle = info.get("uploader_id") or info.get("uploader")
    if not handle:
        return None
    handle = str(handle).strip()
    if not handle:
        return None
    return handle if handle.startswith("@") else f"@{handle}"


def _extract_duration(info: dict) -> Optional[int]:
    dur = info.get("duration")
    if dur is None:
        return None
    try:
        return int(dur)
    except (TypeError, ValueError):
        return None


_FR_MONTHS = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)


def _format_fr_date(iso: Optional[str]) -> Optional[str]:
    """Format an ISO date/datetime string as a French ``"12 mai 2026"`` label.

    Locale-independent (container locales are unreliable). Returns None on any
    unparseable input.
    """
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    return f"{dt.day} {_FR_MONTHS[dt.month - 1]} {dt.year}"


def _extract_published_at(info: dict) -> Optional[str]:
    """Return the reel's publish time as an ISO-8601 UTC string, or None.

    Prefers yt-dlp's ``timestamp`` (Unix epoch); falls back to ``upload_date``
    (``YYYYMMDD``). Defensive: any bad value yields None rather than raising.
    """
    ts = info.get("timestamp")
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            pass
    ud = info.get("upload_date")
    if ud and re.fullmatch(r"\d{8}", str(ud)):
        s = str(ud)
        try:
            return datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def _extract_caption(info: dict) -> Optional[str]:
    """Return the raw, complete caption (yt-dlp ``description``), or None.

    Stored verbatim — cleaning is applied only to the derived title, never to the
    caption we persist.
    """
    desc = info.get("description")
    if isinstance(desc, str) and desc.strip():
        return desc
    return None


def _is_synthetic_title(title: str, info: dict) -> bool:
    """True when ``title`` is yt-dlp's synthetic Instagram title ``Video by …``.

    Instagram reels have no real title; yt-dlp fabricates ``"Video by {uploader}"``.
    Detecting it lets the title chain skip it instead of reintroducing the very
    string we are replacing. (``info`` is part of the interface for future
    uploader-aware checks.)
    """
    t = (title or "").strip()
    return bool(re.match(r"video by \S", t, re.IGNORECASE))


def _truncate_words(text: str, maxlen: int = TITLE_MAX) -> str:
    """Truncate to at most ``maxlen`` chars (ellipsis included) at a word boundary."""
    if len(text) <= maxlen:
        return text
    cut = text[: maxlen - 1].rstrip()
    if " " in cut:
        cut = cut[: cut.rfind(" ")].rstrip()
    return cut + "…"


def _clean_caption_line(description: str) -> Optional[str]:
    """Return the first *useful* line of a caption, cleaned, or None.

    Useful = still has an alphanumeric character after dropping hashtags/emojis.
    Cleaning is light: drop a trailing run of hashtags, collapse whitespace,
    truncate at a word boundary to TITLE_MAX. The middle of the line is left as-is.
    """
    for raw in (description or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        without_trailing_tags = re.sub(r"(\s*#[^\s#]+)+\s*$", "", line).strip()
        candidate = re.sub(r"\s+", " ", without_trailing_tags).strip()
        if re.search(r"[^\W_]", candidate):  # has a letter or digit
            return _truncate_words(candidate, TITLE_MAX)
    return None


def _fallback_title(info: dict) -> Optional[str]:
    """Build ``@author · date`` (or ``@author`` if no date), else None.

    Reuses ``_extract_author`` for the ``@handle``. Returns None when there is no
    author, letting the caller fall back to DEFAULT_TITLE.
    """
    author = _extract_author(info)
    if not author:
        return None
    date = _format_fr_date(_extract_published_at(info))
    return f"{author} · {date}" if date else author


def _resolve_title(info: dict) -> str:
    """Resolve a meaningful title for an ingested reel.

    Chain: (1) first useful caption line → (2) a real, non-synthetic yt-dlp
    title → (3) ``@author · date`` → (4) DEFAULT_TITLE. Pure and total: always
    returns a non-empty string.
    """
    from_caption = _clean_caption_line(info.get("description") or "")
    if from_caption:
        return from_caption

    title = (info.get("title") or "").strip()
    if title and not _is_synthetic_title(title, info):
        first_line = title.splitlines()[0].strip()
        if first_line:
            return _truncate_words(first_line, TITLE_MAX)

    return _fallback_title(info) or DEFAULT_TITLE


# --- pipeline ---------------------------------------------------------------

async def run_ingest(video_id: str, user_id: str, url: str) -> None:
    """Run the full ingestion pipeline for an already-created ``videos`` row.

    Never raises: failures are recorded as ``status='error'`` on the row.
    External I/O (yt-dlp, ffmpeg) runs in a worker thread to avoid blocking
    the event loop.
    """
    settings = get_settings()
    rel_video = settings.rel_video_path(user_id, video_id)
    rel_thumb = settings.rel_thumb_path(user_id, video_id)
    video_path = settings.abs_path(rel_video)
    thumb_path = settings.abs_path(rel_thumb)

    try:
        supa.update_video(video_id, {"status": "fetching"})
        info = await asyncio.to_thread(
            _download, url, video_path, settings.ig_cookies_file, settings.max_video_mb
        )

        # yt-dlp peut abandonner (ex. max_filesize dépassé) sans toujours lever :
        # on vérifie qu'un fichier non-vide a bien été produit pour une erreur claire.
        if not video_path.exists() or video_path.stat().st_size == 0:
            raise RuntimeError("aucun fichier téléchargé (taille max dépassée ou vidéo indisponible)")

        # Normalise to an iOS-decodable file (H.264 + faststart) before marking
        # ready, so a VP9/AV1 download never reaches the iPhone as a black player.
        await asyncio.to_thread(_ensure_ios_compatible, video_path)

        supa.update_video(video_id, {"status": "thumbnailing"})
        await asyncio.to_thread(_thumbnail, video_path, thumb_path)
        color = await asyncio.to_thread(_dominant_color, video_path)

        supa.update_video(
            video_id,
            {
                "status": "ready",
                "storage_path": rel_video,
                "thumb_path": rel_thumb,
                "title": _resolve_title(info),
                "author": _extract_author(info),
                "duration_seconds": _extract_duration(info),
                "caption": _extract_caption(info),
                "published_at": _extract_published_at(info),
                "thumb_color": color,
            },
        )
    except asyncio.CancelledError:
        # Cancelled by DELETE (Spec 06): stop here without rewriting any file or
        # status — the row + files are being purged by the caller. Re-raise so
        # the task is properly marked cancelled.
        raise
    except Exception as exc:  # noqa: BLE001 — any failure -> error status, no crash
        message = str(exc) or exc.__class__.__name__
        try:
            supa.update_video(video_id, {"status": "error", "error": message[:500]})
        except Exception:
            pass
