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
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response

from . import auth, ingest, media, supa
from . import shares as shares_mod
from .config import get_settings, service_role_key_issue
from .models import (
    IngestRequest,
    IngestResponse,
    IngestStatus,
    MediaUrls,
    ShareCreate,
    ShareCreated,
    ShareInfo,
    ShareGlobalInfo,
    ShareVideoRef,
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
        thumb_url = f"/api/videos/{video_id}/thumb?t={token}"
        if row.get("media_type") == "image":
            slides = [
                f"/api/videos/{video_id}/slide/{m['i']}?t={token}"
                for m in (row.get("media") or [])
            ]
            return MediaUrls(media_type="image", slides=slides, thumb_url=thumb_url)
        return MediaUrls(
            media_type="video",
            stream_url=f"/api/videos/{video_id}/stream?t={token}",
            thumb_url=thumb_url,
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

    @router.get("/{video_id}/slide/{i}")
    async def slide(
        video_id: str,
        i: int,
        request: Request,
        t: str = Query(...),
    ):
        owner_id = _video_id_from_media_token(video_id, t)
        row = supa.get_video(video_id, user_id=owner_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        media_list = row.get("media") or []
        # Look up by stored `i`, not by positional index (Fix 3).
        slide_entry = next((m for m in media_list if m.get("i") == i), None)
        if slide_entry is None:
            raise HTTPException(status_code=404, detail="Slide not found")
        rel = slide_entry.get("path")
        if not rel:
            raise HTTPException(status_code=404, detail="Slide not found")
        path = get_settings().abs_path(rel)
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        # Serve correct MIME type per extension (Fix 2).
        _MIME = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".heic": "image/heic",
        }
        ext = rel.lower().rsplit(".", 1)[-1] if "." in rel else ""
        ctype = _MIME.get(f".{ext}", "image/jpeg")
        return media.stream_file(path, request.headers.get("Range"), media_type=ctype)

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
        rels = [row.get("storage_path"), row.get("thumb_path")]
        rels += [m.get("path") for m in (row.get("media") or [])]
        # De-duplicate (Fix 4): for image posts storage_path == media[0]["path"],
        # avoid unlinking twice. Preserve order via dict.fromkeys.
        for rel in dict.fromkeys(r for r in rels if r):
            try:
                settings.abs_path(rel).unlink()
            except (FileNotFoundError, ValueError):
                pass
        # Retire le dossier de slides s'il est vide — image posts only (Fix 1).
        # For video posts storage_path is the shared videos/<user>/ dir parent,
        # which must NOT be rmdir'd. Only image posts have a dedicated per-post
        # directory (videos/<user>/<vid>/).
        if row.get("media_type") == "image":
            media_items = row.get("media") or []
            slide_rel = (
                media_items[0].get("path") if media_items
                else row.get("storage_path")
            )
            if slide_rel and "/" in slide_rel:
                try:
                    settings.abs_path(slide_rel).parent.rmdir()
                except (FileNotFoundError, OSError, ValueError):
                    pass
        supa.delete_video(video_id, user_id)
        return Response(status_code=204)

    return router


# --- shares helpers + router ------------------------------------------------

def _share_url(slug: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/s/{slug}"


def _share_info(row: dict) -> dict:
    return {
        "id": row["id"], "slug": row["slug"], "url": _share_url(row["slug"]),
        "status": shares_mod.share_status(row),
        "expires_at": row.get("expires_at"),
        "has_password": bool(row.get("password_hash")),
        "view_count": row.get("view_count", 0),
        "created_at": str(row.get("created_at", "")),
    }


def _build_shares_router() -> APIRouter:
    router = APIRouter(tags=["shares"])

    @router.post("/videos/{video_id}/shares", response_model=ShareCreated, status_code=201)
    async def create_share(video_id: str, body: ShareCreate,
                           user_id: str = Depends(auth.resolve_user_jwt_only)):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if row.get("status") != "ready":
            raise HTTPException(status_code=400, detail="Video not ready")
        try:
            exp = shares_mod.expires_at_from(body.expires_in)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_in")
        exp_iso = datetime.fromtimestamp(exp, timezone.utc).isoformat() if exp else None
        pw_hash = shares_mod.hash_password(body.password) if body.password else None
        created = supa.insert_share(user_id, video_id, shares_mod.new_slug(), pw_hash, exp_iso)
        return ShareCreated(id=created["id"], slug=created["slug"], url=_share_url(created["slug"]),
                            expires_at=created.get("expires_at"), has_password=pw_hash is not None)

    @router.get("/videos/{video_id}/shares", response_model=list[ShareInfo])
    async def list_video_shares(video_id: str, user_id: str = Depends(auth.resolve_user_jwt_only)):
        return [_share_info(r) for r in supa.list_shares_for_video(video_id, user_id)]

    @router.get("/shares", response_model=list[ShareGlobalInfo])
    async def list_all_shares(user_id: str = Depends(auth.resolve_user_jwt_only)):
        out = []
        for r in supa.list_shares_for_user(user_id):
            info = _share_info(r)
            v = r.get("videos") or None
            if v:
                info["video"] = {"id": v["id"], "title": v.get("title", ""),
                                 "thumb_color": v.get("thumb_color"), "media_type": v.get("media_type", "video")}
            out.append(info)
        return out

    @router.delete("/shares/{share_id}", status_code=204)
    async def delete_share(share_id: str, user_id: str = Depends(auth.resolve_user_jwt_only)):
        supa.revoke_share(share_id, user_id, datetime.now(timezone.utc).isoformat())
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
    api.include_router(_build_shares_router())

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
