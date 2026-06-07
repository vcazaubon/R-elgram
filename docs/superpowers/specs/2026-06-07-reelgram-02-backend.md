# Spec 02 — Backend ingestion (FastAPI + yt-dlp + ffmpeg)

> Lis `2026-06-07-reelgram-design.md` (surtout §5 contrat d'API, §6 env).
> Dépend de Spec 01 (schéma).

## Objectif
Construire le service **FastAPI** qui : récupère les vidéos Instagram via
**yt-dlp** (avec cookies), génère une **miniature** (ffmpeg), stocke les fichiers
sur le **volume local**, écrit les métadonnées dans Supabase (service role), et
sert les médias en HTTP range derrière des URLs signées. Plus la gestion des
**tokens personnels** pour le Raccourci iOS.

## Stack
Python 3.12, FastAPI, uvicorn, `yt-dlp`, `PyJWT`, `supabase` (client py),
`httpx`. `ffmpeg` installé via le système (cf. Dockerfile, Spec 07).

`backend/requirements.txt` :
```
fastapi
uvicorn[standard]
yt-dlp
PyJWT
supabase
httpx
python-multipart
```

## Modules (`backend/app/`)

### `config.py`
Charge les settings depuis l'env (`Design maître §6`) : `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `MEDIA_TOKEN_SECRET`,
`DATA_DIR` (défaut `/data`), `IG_COOKIES_FILE` (optionnel), `MAX_VIDEO_MB`
(défaut 300). Crée `DATA_DIR/videos` et `DATA_DIR/thumbs` au démarrage.

### `auth.py`
- `verify_jwt(token) -> user_id` : décode le JWT Supabase en HS256 avec
  `SUPABASE_JWT_SECRET`, `audience="authenticated"`, renvoie `sub`. Lève 401 si invalide.
- `resolve_user(request) -> user_id` : dépendance FastAPI qui accepte
  `Authorization: Bearer <jwt>` **ou** `X-Reelgram-Token: <token>`. Pour le token :
  `sha256(token)` → lookup `api_tokens.token_hash` via service role ; met à jour
  `last_used_at`. Renvoie `user_id` ou 401.
- `resolve_user_jwt_only(request)` : variante n'acceptant que le JWT (pour
  `/tokens` et `/media-url`).

### `supa.py`
Client `supabase` initialisé avec l'URL + **service role key**. Helpers :
`insert_video`, `update_video(id, fields)`, `get_video(id)` (filtre par `user_id`
côté code pour sécurité défense-en-profondeur).

### `media.py`
- `sign_media_token(video_id, user_id, ttl=3600) -> str` : base64url d'un payload
  `{vid, uid, exp}` + HMAC-SHA256(`MEDIA_TOKEN_SECRET`).
- `verify_media_token(t) -> (video_id, user_id)` : vérifie signature + expiration.
- `stream_file(path, range_header)` : réponse 206 Partial Content avec
  `Accept-Ranges`, `Content-Range`, `Content-Length` corrects (lecture par chunks).

### `ingest.py`
Job asynchrone d'ingestion :
1. `status=analyzing` (row déjà créée par l'endpoint).
2. `status=fetching` → yt-dlp télécharge la vidéo dans
   `DATA_DIR/videos/<uid>/<vid>.mp4`. Options yt-dlp :
   - `format`: meilleur mp4 (`bv*+ba/b` avec merge mp4) ; `outtmpl` fixé ;
   - `cookiefile=IG_COOKIES_FILE` si défini ;
   - `noplaylist=True`, `quiet=True`, garde-fou taille via `max_filesize`
     (`MAX_VIDEO_MB`).
   - Récupère les métadonnées : `title` (caption/1ʳᵉ ligne, tronquée ~80 car.),
     `uploader`/`uploader_id` → `author = "@" + handle`, `duration` → `duration_seconds`.
3. `status=thumbnailing` → ffmpeg extrait une frame (~1 s) :
   `ffmpeg -ss 1 -i <video> -frames:v 1 -vf scale=640:-1 <thumb>.jpg`. Extraire la
   **couleur dominante** (moyenne via ffmpeg `scale=1:1` ou Pillow) → `thumb_color`
   (fallback `#a78bfa`).
4. `status=ready` + update `storage_path`, `thumb_path`, `title`, `author`,
   `duration_seconds`, `thumb_color`.
- **Erreurs** : tout échec → `status=error` + `error` (message court). Pas de crash.
- Exécution : `asyncio.create_task` (ou `BackgroundTasks`) ; le statut vit dans la
  colonne `videos.status`. Conserver en mémoire le `step` courant pour
  `/ingest/{id}/status` si besoin de granularité, sinon dériver `step` du `status`
  (cf. `Design maître §5`).

### `tokens.py`
- `POST /api/tokens` (JWT) : génère un token aléatoire (`secrets.token_urlsafe(32)`),
  stocke `sha256`, renvoie le **plaintext une seule fois** + `id`.
- `GET /api/tokens` (JWT) : liste (sans le secret).
- `DELETE /api/tokens/{id}` (JWT) : révoque (vérifie `user_id`).

### `main.py`
Monte toutes les routes du `Design maître §5` sous `/api`. Endpoints :
- `GET /api/health` → `{status:"ok"}`.
- `POST /api/ingest` (`resolve_user`) : valide l'URL (doit être instagram.com),
  crée la row `videos` (`status=analyzing`, `source_url`, `category_id` validé
  appartenir au user), lance le job, renvoie `{id, status}`.
- `GET /api/ingest/{id}/status` (`resolve_user`) : renvoie `{status, step, error}`
  après contrôle `user_id`.
- `GET /api/videos/{id}/media-url` (`resolve_user_jwt_only`) : renvoie
  `{stream_url, thumb_url}` = `/api/videos/{id}/stream?t=...` & `/thumb?t=...`
  (tokens signés).
- `GET /api/videos/{id}/stream` (media token) : vérifie token, lit
  `storage_path`, stream range.
- `GET /api/videos/{id}/thumb` (media token) : sert le jpeg.
- routes `tokens`.

CORS : non requis (same-origin via nginx, cf. Spec 07). Garder une option
`CORS_ORIGINS` désactivée par défaut au cas où on déploie en sous-domaines séparés.

## Critères d'acceptation
- `uvicorn app.main:app` démarre ; `GET /api/health` → 200.
- Avec un JWT Supabase valide, `POST /api/ingest {url}` crée une row et déclenche
  le téléchargement ; `GET /ingest/{id}/status` passe `analyzing→fetching→thumbnailing→ready`.
- Le fichier vidéo et la miniature existent sous `DATA_DIR` ; la row est mise à
  jour (chemins, titre, auteur, durée, couleur).
- `media-url` renvoie des URLs signées ; `/stream` répond en 206 avec Range ;
  `/thumb` renvoie l'image. Un token signé expiré/altéré → 403.
- Un user ne peut pas lire la vidéo d'un autre (contrôle `user_id` + token signé lié au user).
- Création/usage/révocation d'un token perso OK ; un appel `POST /api/ingest`
  avec `X-Reelgram-Token` ingère dans le bon compte.
- Une URL non-Instagram ou un échec yt-dlp → `status=error` propre (pas de 500 non géré).

## Tests
- Tests unitaires : `sign/verify_media_token` (valide, expiré, altéré),
  `verify_jwt` (valide/invalide), dérivation `status→step`.
- Test d'intégration (mock yt-dlp/ffmpeg) : pipeline d'ingestion met les bons statuts.
