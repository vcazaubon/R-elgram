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
import html as _html
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
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
    PublicShareMeta,
    ShareCreate,
    ShareCreated,
    ShareInfo,
    ShareGlobalInfo,
    ShareUnlock,
)
from .models import status_to_step

MEDIA_TTL = 3600  # signed media URL lifetime (~1h, cf. §5)
SHARE_TOKEN_TTL = 3600  # share media token lifetime (~1h)

_IMAGE_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
               "webp": "image/webp", "heic": "image/heic"}


def _mime_for(path: str) -> str:
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    return _IMAGE_MIME.get(ext, "image/jpeg")

_unlock_rl = shares_mod.RateLimiter(max_attempts=5, window_seconds=900)

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
        return media.stream_file(path, request.headers.get("Range"), media_type=_mime_for(rel))

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


# --- public share helpers + router ------------------------------------------

def _public_media_urls(slug: str, video: dict) -> dict:
    token = media.sign_share_token(slug, ttl=SHARE_TOKEN_TTL)
    thumb = f"/api/share/{slug}/thumb?t={token}"
    if video.get("media_type") == "image":
        slides = [f"/api/share/{slug}/slide/{m['i']}?t={token}" for m in (video.get("media") or [])]
        return {"slides": slides, "thumb_url": thumb}
    return {"stream_url": f"/api/share/{slug}/stream?t={token}", "thumb_url": thumb}


def _resolve_active_share(slug: str) -> dict:
    """Renvoie la ligne share si active ; 404 si inconnue, 410 si expirée/révoquée."""
    row = supa.get_share_by_slug(slug)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    if shares_mod.share_status(row) != "active":
        raise HTTPException(status_code=410, detail="Link no longer active")
    return row


def _share_token_owner_slug(slug: str, t: str) -> None:
    try:
        tok_slug = media.verify_share_token(t)
    except media.MediaTokenError:
        raise HTTPException(status_code=403, detail="Invalid token")
    if tok_slug != slug:
        raise HTTPException(status_code=403, detail="Token not valid for this link")


def _build_public_share_router() -> APIRouter:
    router = APIRouter(prefix="/share", tags=["public-share"])

    @router.get("/{slug}", response_model=PublicShareMeta)
    async def resolve(slug: str):
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=410, detail="Link no longer active")
        try:
            supa.increment_share_view(row["id"], row.get("view_count", 0) + 1,
                                      datetime.now(timezone.utc).isoformat())
        except Exception:
            pass
        meta = {"media_type": video.get("media_type", "video"), "title": video.get("title", ""),
                "needs_password": bool(row.get("password_hash")), "expires_at": row.get("expires_at")}
        if not row.get("password_hash"):
            meta.update(_public_media_urls(slug, video))
        return PublicShareMeta(**meta)

    @router.post("/{slug}/unlock", response_model=PublicShareMeta)
    async def unlock(slug: str, body: ShareUnlock, request: Request):
        row = _resolve_active_share(slug)
        ip = request.client.host if request.client else "?"
        if not _unlock_rl.allow(f"{slug}:{ip}"):
            raise HTTPException(status_code=429, detail="Too many attempts")
        if not shares_mod.verify_password(body.password, row.get("password_hash")):
            raise HTTPException(status_code=403, detail="Wrong password")
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=410, detail="Link no longer active")
        meta = {"media_type": video.get("media_type", "video"), "title": video.get("title", ""),
                "needs_password": True, "expires_at": row.get("expires_at")}
        meta.update(_public_media_urls(slug, video))
        return PublicShareMeta(**meta)

    @router.get("/{slug}/stream")
    async def stream(slug: str, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("storage_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["storage_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="video/mp4")

    @router.get("/{slug}/slide/{i}")
    async def slide(slug: str, i: int, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=404, detail="Not found")
        entry = next((m for m in (video.get("media") or []) if m.get("i") == i), None)
        if not entry or not entry.get("path"):
            raise HTTPException(status_code=404, detail="Slide not found")
        path = get_settings().abs_path(entry["path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type=_mime_for(entry["path"]))

    @router.get("/{slug}/thumb")
    async def thumb(slug: str, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("thumb_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["thumb_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="image/jpeg")

    @router.get("/{slug}/og")
    async def og_thumb(slug: str, request: Request):
        row = _resolve_active_share(slug)
        if row.get("password_hash"):
            raise HTTPException(status_code=404, detail="Protected")
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("thumb_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["thumb_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="image/jpeg")

    return router


# --- public share shell -----------------------------------------------------

def _render_share_shell(slug: str, *, title: str, protected: bool, media_type: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    page_url = f"{base}/s/{slug}"
    safe_title = _html.escape(title or "Réelgram")
    if protected:
        og_title, og_desc = "Réel protégé · Réelgram", "Saisis le code pour voir ce réel."
        og_image_tag = ""
    else:
        og_title, og_desc = safe_title, "Partagé via Réelgram"
        og_image_tag = f'<meta property="og:image" content="{base}/api/share/{slug}/og">'
    og_type = "video.other" if media_type == "video" else "website"
    dist = get_settings().public_dist_dir
    head_extra = (
        f'<meta property="og:title" content="{og_title}">'
        f'<meta property="og:description" content="{og_desc}">'
        f'<meta property="og:type" content="{og_type}">'
        f'<meta property="og:url" content="{page_url}">'
        f'{og_image_tag}'
        f'<meta name="twitter:card" content="summary_large_image">'
        f'<title>{og_title}</title>'
    )
    if dist:
        built = Path(dist) / "public-share.html"
        if built.exists():
            doc = built.read_text(encoding="utf-8")
            doc = re.sub(r"<title>.*?</title>", "", doc, count=1, flags=re.DOTALL)
            return doc.replace("</head>", head_extra + "</head>", 1)
    return (
        f'<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'{head_extra}</head><body><div id="root"></div>'
        f'<script src="/env.js"></script>'
        f'<script type="module" src="/public-share.js"></script></body></html>'
    )


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
    api.include_router(_build_public_share_router())

    from .tokens import router as tokens_router
    api.include_router(tokens_router)

    app.include_router(api)

    @app.get("/s/{slug}")
    async def share_shell(slug: str):
        row = supa.get_share_by_slug(slug)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if shares_mod.share_status(row) != "active":
            raise HTTPException(status_code=410, detail="Link no longer active")
        video = supa.get_video_service(row["video_id"]) or {}
        html_doc = _render_share_shell(
            slug, title=video.get("title", "Réelgram"),
            protected=bool(row.get("password_hash")), media_type=video.get("media_type", "video"),
        )
        from fastapi.responses import HTMLResponse
        return HTMLResponse(html_doc)

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
