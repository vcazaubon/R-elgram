"""Signed media tokens (HMAC-SHA256) + HTTP range streaming helper.

Media elements (``<video>``/``<img>``) cannot send an ``Authorization`` header,
so ``/stream`` and ``/thumb`` are authenticated with a short-lived signed token
passed as ``?t=``. The token binds a (video_id, user_id, exp) triple, signed
with ``MEDIA_TOKEN_SECRET``.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Optional, Tuple

from fastapi import Response
from fastapi.responses import StreamingResponse

from .config import get_settings

CHUNK_SIZE = 1024 * 1024  # 1 MiB


class MediaTokenError(Exception):
    """Raised when a media token is invalid, tampered with, or expired."""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _secret() -> bytes:
    return get_settings().media_token_secret.encode("utf-8")


def _sign(payload_b64: str) -> str:
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64url_encode(sig)


def sign_media_token(video_id: str, user_id: str, ttl: int = 3600) -> str:
    payload = {"vid": video_id, "uid": user_id, "exp": int(time.time()) + ttl}
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_media_token(token: str) -> Tuple[str, str]:
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError as exc:
        raise MediaTokenError("malformed token") from exc

    expected = _sign(payload_b64)
    if not hmac.compare_digest(expected, sig):
        raise MediaTokenError("bad signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise MediaTokenError("bad payload") from exc

    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise MediaTokenError("expired")

    vid, uid = payload.get("vid"), payload.get("uid")
    if not vid or not uid:
        raise MediaTokenError("incomplete payload")
    return vid, uid


def _parse_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """Parse a single ``bytes=start-end`` range. Returns (start, end) inclusive."""
    if not range_header or not range_header.startswith("bytes="):
        return None
    spec = range_header[len("bytes="):].split(",")[0].strip()
    if "-" not in spec:
        return None
    start_s, end_s = spec.split("-", 1)
    if start_s == "":
        # suffix range: last N bytes
        if end_s == "":
            return None
        length = int(end_s)
        if length <= 0:
            return None
        start = max(file_size - length, 0)
        end = file_size - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else file_size - 1
    end = min(end, file_size - 1)
    if start > end or start >= file_size:
        return None
    return start, end


def stream_file(path: Path, range_header: Optional[str], media_type: str = "application/octet-stream") -> Response:
    """Serve ``path`` with HTTP range support.

    Returns a 206 ``StreamingResponse`` when a valid Range header is supplied,
    otherwise a 200 full-body streaming response. Reads in chunks.
    """
    file_size = path.stat().st_size
    parsed = _parse_range(range_header, file_size) if range_header else None

    if parsed is None:
        def full_iter():
            with open(path, "rb") as f:
                while chunk := f.read(CHUNK_SIZE):
                    yield chunk

        return StreamingResponse(
            full_iter(),
            status_code=200,
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )

    start, end = parsed
    length = end - start + 1

    def range_iter():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(
        range_iter(),
        status_code=206,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        },
    )
