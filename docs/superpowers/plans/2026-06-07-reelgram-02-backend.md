# Réelgram Spec 02 — Backend FastAPI (yt-dlp + ffmpeg) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. TDD : test rouge → impl verte → commit. Steps en `- [ ]`.

**Goal:** Service FastAPI qui ingère des vidéos Instagram (yt-dlp), génère des miniatures (ffmpeg), stocke sur volume local, écrit les métadonnées dans Supabase (service role), et sert les médias en HTTP range derrière des URLs signées ; + tokens personnels pour le Raccourci iOS.

**Architecture:** Modules découplés sous `backend/app/` ; logique pure (media token, auth, status→step) testée en isolation ; I/O externes (yt-dlp, ffmpeg, supabase) mockés dans les tests ; routes montées sous `/api`. Pas de CORS (same-origin via nginx). `DELETE /api/videos/{id}` volontairement HORS scope (Spec 06) mais `main.py` structuré pour l'y greffer.

**Tech Stack:** Python 3.12+, FastAPI, uvicorn, yt-dlp, PyJWT, supabase-py, httpx, pytest (+pytest-asyncio). ffmpeg système.

---

## File Structure
- `backend/requirements.txt` — deps.
- `backend/pytest.ini` — `asyncio_mode = auto`.
- `backend/app/__init__.py`
- `backend/app/config.py` — Settings (env §6) + helpers chemins + `abs_path` confiné à DATA_DIR + `ensure_dirs`.
- `backend/app/models.py` — pydantic (IngestRequest, IngestResponse, IngestStatus, TokenCreate…) + `status_to_step`.
- `backend/app/media.py` — `sign_media_token`/`verify_media_token` + `stream_file` (206 range).
- `backend/app/auth.py` — `verify_jwt`, `hash_token`, `resolve_user`, `resolve_user_jwt_only`.
- `backend/app/supa.py` — client service-role + helpers videos/tokens/categories.
- `backend/app/ingest.py` — pipeline async yt-dlp+ffmpeg, statuts.
- `backend/app/tokens.py` — router CRUD `/api/tokens`.
- `backend/app/main.py` — app + routes §5 + validation URL + health.
- `backend/tests/` — test_config, test_media_token, test_auth, test_models, test_ingest, test_api.

---

## Phase A — Scaffold + logique pure (config, media token, auth, models)

### Task A1: requirements + scaffold + config
**Files:** Create `backend/requirements.txt`, `backend/pytest.ini`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/tests/__init__.py`, `backend/tests/test_config.py`

- [ ] **Step 1: requirements.txt**
```
fastapi
uvicorn[standard]
yt-dlp
PyJWT
supabase
httpx
python-multipart
```
- [ ] **Step 2: venv + install**
Run: `cd backend && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt pytest pytest-asyncio`
- [ ] **Step 3: test_config (rouge)** — `abs_path` confine à DATA_DIR :
```python
import os, tempfile
from app.config import Settings
from pathlib import Path
def test_abs_path_confined(tmp_path):
    s = Settings(supabase_url="",supabase_service_role_key="",supabase_jwt_secret="",
                 media_token_secret="x",data_dir=tmp_path,ig_cookies_file=None,max_video_mb=300)
    assert s.abs_path("videos/u/v.mp4") == (tmp_path/"videos/u/v.mp4").resolve()
    import pytest
    with pytest.raises(ValueError):
        s.abs_path("../../etc/passwd")
    with pytest.raises(ValueError):
        s.abs_path("/etc/passwd")
```
- [ ] **Step 4: config.py** — `Settings` (frozen dataclass) avec champs du §6, `videos_dir`/`thumbs_dir`/`video_path`/`thumb_path`/`rel_video_path`/`rel_thumb_path`, `abs_path` (résout + vérifie `is_relative_to(data_dir.resolve())`, lève ValueError sinon), `ensure_dirs`, `load_settings()` (défauts vides tolérés), `get_settings()` lru_cache.
- [ ] **Step 5: run** `cd backend && .venv/bin/pytest tests/test_config.py -q` → PASS
- [ ] **Step 6: commit** `git add backend && git commit -m "Spec 02 A1: scaffold + config (abs_path confiné DATA_DIR)"`

### Task A2: media token (sign/verify) + stream helper
**Files:** Create `backend/app/media.py`, `backend/tests/test_media_token.py`

- [ ] **Step 1: tests (rouge)** :
```python
import time, pytest
from app import media
def test_sign_verify_roundtrip(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET","s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings; get_settings.cache_clear()
    t = media.sign_media_token("vid1","usr1",ttl=60)
    vid,uid = media.verify_media_token(t)
    assert (vid,uid)==("vid1","usr1")
def test_expired(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET","s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings; get_settings.cache_clear()
    t = media.sign_media_token("v","u",ttl=-1)
    with pytest.raises(media.MediaTokenError): media.verify_media_token(t)
def test_tampered(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET","s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings; get_settings.cache_clear()
    t = media.sign_media_token("v","u",ttl=60)
    with pytest.raises(media.MediaTokenError): media.verify_media_token(t[:-2]+"xy")
```
- [ ] **Step 2: media.py** — `MediaTokenError`; `sign_media_token(vid,uid,ttl=3600)` = base64url(json{vid,uid,exp}) + "." + base64url(hmac_sha256(secret,payload)); `verify_media_token(t)` : split, recompute HMAC (compare `hmac.compare_digest`), check exp, renvoie (vid,uid) ou lève MediaTokenError ; `stream_file(path, range_header)` → FastAPI Response 206 avec Accept-Ranges/Content-Range/Content-Length (lecture par chunks), 200 si pas de range.
- [ ] **Step 3: run** `.venv/bin/pytest tests/test_media_token.py -q` → PASS
- [ ] **Step 4: commit** `git add backend && git commit -m "Spec 02 A2: media token HMAC + stream range"`

### Task A3: auth (verify_jwt, hash_token, resolve_user) + models
**Files:** Create `backend/app/auth.py`, `backend/app/models.py`, `backend/tests/test_auth.py`, `backend/tests/test_models.py`

- [ ] **Step 1: test_models (rouge)** — `status_to_step`: analyzing→0, fetching→1, thumbnailing→2, ready→3, error→-1.
- [ ] **Step 2: test_auth (rouge)** — avec `jwt.encode({sub,aud:'authenticated',exp:now+60}, secret, HS256)` : `verify_jwt` renvoie sub ; mauvaise signature → 401 (HTTPException) ; mauvaise audience → 401 ; sans `exp` → 401 (require exp). `hash_token` = sha256 hex stable. `resolve_user` via `X-Reelgram-Token` (monkeypatch `supa.find_token` → row) renvoie user_id + appelle `touch_token` ; token inconnu → 401 ; aucun header → 401.
- [ ] **Step 3: models.py** — pydantic models + `STATUS_STEP`/`status_to_step`.
- [ ] **Step 4: auth.py** — `verify_jwt` (HS256, audience 'authenticated', `options={"require":["exp","sub"]}`, renvoie sub, 401 sinon) ; `hash_token` (sha256) ; `_bearer_token` ; `_resolve_personal_token` (hash→`supa.find_token`→`supa.touch_token` best-effort) ; `resolve_user` (Bearer JWT OU X-Reelgram-Token) ; `resolve_user_jwt_only`.
- [ ] **Step 5: run** `.venv/bin/pytest tests/test_auth.py tests/test_models.py -q` → PASS
- [ ] **Step 6: commit** `git add backend && git commit -m "Spec 02 A3: auth JWT + token perso + models"`

---

## Phase B — supa + ingest + (intégration via main)

### Task B1: supa.py (service-role helpers)
**Files:** Create `backend/app/supa.py`
- [ ] **Step 1:** Client `supabase.create_client(SUPABASE_URL, SERVICE_ROLE_KEY)` lazy (créé à la 1ʳᵉ utilisation pour permettre l'import sans env). Helpers : `insert_video(user_id,source_url,category_id)` (force status='analyzing'), `update_video(id,fields)`, `get_video(id,user_id=None)` (filtre user_id si fourni), `category_belongs_to_user(category_id,user_id)`, `find_token(token_hash)`, `touch_token(id,iso)`, `insert_token(user_id,token_hash,label)`, `list_tokens(user_id)`, `delete_token(id,user_id)`. (Testés indirectement via mocks dans test_api/test_ingest.)
- [ ] **Step 2: commit** `git add backend && git commit -m "Spec 02 B1: supa service-role helpers"`

### Task B2: ingest pipeline (TDD, yt-dlp/ffmpeg mockés)
**Files:** Create `backend/app/ingest.py`, `backend/tests/test_ingest.py`
- [ ] **Step 1: tests (rouge)** — monkeypatch un faux downloader yt-dlp (écrit un fichier mp4 factice + renvoie infos title/uploader_id/duration) et un faux ffmpeg (écrit un jpg + renvoie couleur) :
  - `run_ingest(video_id,user_id,url,...)` passe `videos.status` `fetching`→`thumbnailing`→`ready` (capter via un faux `supa.update_video`), écrit `storage_path`/`thumb_path`/`title`/`author`(=@uploader_id)/`duration_seconds`/`thumb_color`.
  - yt-dlp qui lève → `status='error'` + `error` rempli, pas d'exception propagée.
- [ ] **Step 2: ingest.py** — `run_ingest` async : `_download(url,dest,cookies,max_mb)` (yt-dlp YoutubeDL, format mp4, cookiefile si défini, max_filesize), `_thumbnail(src,dst)` (ffmpeg -ss 1 -frames:v 1 scale=640:-1), `_dominant_color(src)` (ffmpeg 1x1 rgb24 → hex, fallback #a78bfa), extraction title (1ʳᵉ ligne ≤80c, fallback 'Sans titre') / author (@uploader_id||uploader) / duration. try/except global → status='error'.
- [ ] **Step 3: run** `.venv/bin/pytest tests/test_ingest.py -q` → PASS
- [ ] **Step 4: commit** `git add backend && git commit -m "Spec 02 B2: pipeline ingestion yt-dlp+ffmpeg (mocké en test)"`

### Task B3: tokens router + main.py (routes §5) + URL validation + integration tests
**Files:** Create `backend/app/tokens.py`, `backend/app/main.py`, `backend/tests/test_api.py`
- [ ] **Step 1: tests API (rouge, TestClient + mocks supa/ingest)** :
  - `GET /api/health` → 200 `{status:"ok"}`.
  - `POST /api/ingest` sans auth → 401 ; URL non-instagram → 400 ; avec JWT valide + URL instagram → 201/200 `{id,status}` (mock insert_video + tâche ingest mockée) ; `category_id` d'un autre user → 400.
  - `GET /api/ingest/{id}/status` filtre user_id, renvoie `{status,step,error}`.
  - `GET /api/videos/{id}/media-url` (JWT) → URLs signées contenant `?t=`.
  - `GET /api/videos/{id}/stream?t=` (token valide d'un autre vid/uid → 403 ; valide → 200/206).
  - tokens : POST (renvoie plaintext une fois + hash stocké via mock), GET (sans secret), DELETE (filtré user).
- [ ] **Step 2: tokens.py + main.py** — router tokens (resolve_user_jwt_only) ; `_build_videos_router()` isolant les routes videos (pour greffe DELETE en Spec 06) ; validation URL `*.instagram.com` (schéma http/https) ; `lifespan` → `ensure_dirs()` ; pas de CORS (option `CORS_ORIGINS` désactivée par défaut).
- [ ] **Step 3: run** `.venv/bin/pytest -q` (toute la suite) → tout PASS ; `.venv/bin/python -c "import app.main"` → OK.
- [ ] **Step 4: commit** `git add backend && git commit -m "Spec 02 B3: routes /api (ingest,status,media,tokens,health) + validation URL"`

---

## Self-Review
- **Spec coverage :** routes §5 (sauf DELETE) → A2/A3/B3 ✓ ; yt-dlp+cookies+ffmpeg+max_mb → B2 ✓ ; media token signé → A2 ✓ ; auth JWT+token → A3 ✓ ; isolation user_id → B1/B3 ✓ ; abs_path confiné → A1 ✓ ; tests mockés → A/B ✓.
- **Placeholders :** test cases fournis en code ; impl décrite précisément (signatures, comportements). Pas de TODO.
- **Type consistency :** champs alignés sur `0001_init.sql` + `frontend/src/lib/types.ts` (status set, author '@handle', thumb_color, storage_path/thumb_path). `status_to_step` cohérent avec `STATUS_STEP` du front.
