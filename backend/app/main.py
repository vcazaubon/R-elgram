"""FastAPI application — routes of Design maître §5 mounted under ``/api``.

Two auth paths (cf. ``auth.py``): JWT or personal token for ingest/status; JWT
only for media-url and tokens; signed media token (``?t=``) for stream/thumb.

``DELETE /api/videos/{id}`` (Spec 06) purges the row + file + thumbnail and
cancels an in-flight ingest; it lives in :func:`_build_videos_router` with the
other videos routes. No CORS by default (same-origin via nginx); ``CORS_ORIGINS``
is the off switch.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response

from . import auth, ingest, media, supa
from .config import get_settings, service_role_key_issue
from .models import (
    IngestRequest,
    IngestResponse,
    IngestStatus,
    MediaUrls,
)
from .models import status_to_step

MEDIA_TTL = 3600  # signed media URL lifetime (~1h, cf. §5)

# Strong refs to in-flight ingest tasks so they are not GC'd mid-run.
_ingest_tasks: set = set()


def _schedule_ingest(video_id: str, user_id: str, url: str) -> None:
    task = asyncio.create_task(ingest.run_ingest(video_id, user_id, url))
    _ingest_tasks.add(task)
    task.add_done_callback(_ingest_tasks.discard)
    # Register the task by video_id so DELETE (Spec 06) can cancel it in flight.
    ingest._register_ingest(video_id, task)


# --- URL validation ---------------------------------------------------------

def _validate_instagram_url(url: str) -> None:
    """Reject anything that is not an http(s) ``*.instagram.com`` URL (400)."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL must be http(s)")
    host = (parsed.hostname or "").lower()
    if not (host == "instagram.com" or host.endswith(".instagram.com")):
        raise HTTPException(status_code=400, detail="URL must be an instagram.com link")


# --- media token guard ------------------------------------------------------

def _video_id_from_media_token(video_id: str, t: str) -> str:
    """Verify a media token and ensure it is bound to ``video_id`` (403 otherwise)."""
    try:
        tok_vid, _tok_uid = media.verify_media_token(t)
    except media.MediaTokenError:
        raise HTTPException(status_code=403, detail="Invalid media token")
    if tok_vid != video_id:
        raise HTTPException(status_code=403, detail="Token not valid for this video")
    return _tok_uid


# --- routers ----------------------------------------------------------------

def _build_health_router() -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get("/health")
    async def health():
        return {"status": "ok"}

    return router


def _build_ingest_router() -> APIRouter:
    router = APIRouter(tags=["ingest"])

    @router.post("/ingest", response_model=IngestResponse, status_code=201)
    async def ingest_video(
        body: IngestRequest,
        user_id: str = Depends(auth.resolve_user),
    ):
        _validate_instagram_url(body.url)
        if body.category_id is not None:
            if not supa.category_belongs_to_user(body.category_id, user_id):
                raise HTTPException(status_code=400, detail="Unknown category")
        row = supa.insert_video(user_id, body.url, body.category_id)
        video_id = row["id"]
        _schedule_ingest(video_id, user_id, body.url)
        return IngestResponse(id=video_id, status=row.get("status", "analyzing"))

    @router.get("/ingest/{video_id}/status", response_model=IngestStatus)
    async def ingest_status(
        video_id: str,
        user_id: str = Depends(auth.resolve_user),
    ):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        status = row.get("status", "error")
        return IngestStatus(
            status=status,
            step=status_to_step(status),
            error=row.get("error"),
        )

    return router


def _build_videos_router() -> APIRouter:
    """Routes under ``/videos/{id}`` (media-url, stream, thumb, delete)."""
    router = APIRouter(prefix="/videos", tags=["videos"])

    @router.get("/{video_id}/media-url", response_model=MediaUrls)
    async def media_url(
        video_id: str,
        user_id: str = Depends(auth.resolve_user_jwt_only),
    ):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        token = media.sign_media_token(video_id, user_id, ttl=MEDIA_TTL)
        return MediaUrls(
            stream_url=f"/api/videos/{video_id}/stream?t={token}",
            thumb_url=f"/api/videos/{video_id}/thumb?t={token}",
        )

    @router.get("/{video_id}/stream")
    async def stream(
        video_id: str,
        request: Request,
        t: str = Query(...),
    ):
        owner_id = _video_id_from_media_token(video_id, t)
        row = supa.get_video(video_id, user_id=owner_id)
        if not row or not row.get("storage_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(row["storage_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="video/mp4")

    @router.get("/{video_id}/thumb")
    async def thumb(
        video_id: str,
        request: Request,
        t: str = Query(...),
    ):
        owner_id = _video_id_from_media_token(video_id, t)
        row = supa.get_video(video_id, user_id=owner_id)
        if not row or not row.get("thumb_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(row["thumb_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="image/jpeg")

    @router.delete("/{video_id}", status_code=204)
    async def delete_video(
        video_id: str,
        user_id: str = Depends(auth.resolve_user),
    ):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        # Cancel an in-flight ingest before purging so a job still in flight
        # cannot rewrite the files after we delete them.
        if row.get("status") != "ready":
            ingest.cancel_ingest(video_id)
        # Best-effort file purge (idempotent if already gone). abs_path confines
        # the relative paths to DATA_DIR (defense in depth against traversal).
        settings = get_settings()
        for rel in (row.get("storage_path"), row.get("thumb_path")):
            if not rel:
                continue
            try:
                settings.abs_path(rel).unlink()
            except (FileNotFoundError, ValueError):
                pass
        supa.delete_video(video_id, user_id)
        return Response(status_code=204)

    return router


# --- app factory ------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # Fail loudly on a service key that cannot bypass RLS (e.g. the anon key
    # pasted into SUPABASE_SERVICE_ROLE_KEY) instead of silently degrading to
    # "Unknown category" / empty reads at runtime.
    issue = service_role_key_issue(settings.supabase_service_role_key)
    if issue:
        raise RuntimeError(
            f"SUPABASE_SERVICE_ROLE_KEY {issue}. Set it to the project's Secret "
            "key (sb_secret_… or the legacy service_role JWT) from Supabase → "
            "Project Settings → API Keys."
        )
    settings.ensure_dirs()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Réelgram API", lifespan=lifespan)

    api = APIRouter(prefix="/api")
    api.include_router(_build_health_router())
    api.include_router(_build_ingest_router())
    api.include_router(_build_videos_router())

    from .tokens import router as tokens_router
    api.include_router(tokens_router)

    app.include_router(api)

    # CORS is disabled by default (same-origin via nginx). Enable only if
    # CORS_ORIGINS is explicitly set (comma-separated) for split-subdomain deploys.
    origins = os.environ.get("CORS_ORIGINS", "").strip()
    if origins:
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in origins.split(",") if o.strip()],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    return app


app = create_app()
