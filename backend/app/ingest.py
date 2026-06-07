"""Async ingestion pipeline: yt-dlp download + ffmpeg thumbnail + metadata.

The pipeline walks ``videos.status`` through ``fetching`` -> ``thumbnailing`` ->
``ready`` (writing each transition via :func:`supa.update_video`). Any failure
flips the row to ``error`` with a short message and is swallowed (no exception
escapes ``run_ingest`` — the row status is the source of truth, cf. spec §"Erreurs").

External binaries (yt-dlp, ffmpeg) live in private helpers so tests can mock them.
"""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Optional

from . import supa
from .config import get_settings

DEFAULT_TITLE = "Sans titre"
TITLE_MAX = 80
FALLBACK_COLOR = "#a78bfa"


# --- external binaries (mocked in tests) ------------------------------------

def _download(url: str, dest: Path, cookies: Optional[str], max_mb: int) -> dict:
    """Download ``url`` to ``dest`` (mp4) via yt-dlp, returning the info dict."""
    import yt_dlp

    dest.parent.mkdir(parents=True, exist_ok=True)
    opts = {
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(dest),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": max_mb * 1024 * 1024,
    }
    if cookies:
        opts["cookiefile"] = cookies

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return info or {}


def _thumbnail(src: Path, dst: Path) -> None:
    """Extract a frame (~1s) from ``src`` to ``dst`` (640px wide jpeg) via ffmpeg."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", "1", "-i", str(src),
            "-frames:v", "1", "-vf", "scale=640:-1", str(dst),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


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

def _extract_title(info: dict) -> str:
    raw = (info.get("title") or "").strip()
    if not raw:
        return DEFAULT_TITLE
    first_line = raw.splitlines()[0].strip()
    if not first_line:
        return DEFAULT_TITLE
    return first_line[:TITLE_MAX]


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

        supa.update_video(video_id, {"status": "thumbnailing"})
        await asyncio.to_thread(_thumbnail, video_path, thumb_path)
        color = await asyncio.to_thread(_dominant_color, video_path)

        supa.update_video(
            video_id,
            {
                "status": "ready",
                "storage_path": rel_video,
                "thumb_path": rel_thumb,
                "title": _extract_title(info),
                "author": _extract_author(info),
                "duration_seconds": _extract_duration(info),
                "thumb_color": color,
            },
        )
    except Exception as exc:  # noqa: BLE001 — any failure -> error status, no crash
        message = str(exc) or exc.__class__.__name__
        try:
            supa.update_video(video_id, {"status": "error", "error": message[:500]})
        except Exception:
            pass
