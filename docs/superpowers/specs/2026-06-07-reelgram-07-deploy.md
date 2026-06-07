# Spec 07 — Docker & Coolify

> Lis `2026-06-07-reelgram-design.md` (§3 structure, §6 env). Dépend de Spec 02, 03.

## Objectif
Rendre le projet **déployable d'un coup sur Coolify** via `docker-compose.yml` :
`web` (nginx servant la PWA + reverse-proxy `/api`) + `api` (FastAPI) + un
**volume persistant** pour les vidéos. Avec healthchecks, config runtime, et un
README/guide de déploiement.

## Tâches

### 1. Backend Dockerfile → `backend/Dockerfile`
- Base `python:3.12-slim`.
- Installer `ffmpeg` (apt) + dépendances de `requirements.txt`.
- Copier `app/`. Créer `DATA_DIR=/data`.
- `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- `HEALTHCHECK` : `curl -f http://localhost:8000/api/health`.
- Exposer 8000 (interne).

### 2. Frontend Dockerfile → `frontend/Dockerfile` (multi-stage)
- **Stage build** : `node:20-alpine`, `npm ci`, `npm run build` → `dist/`.
- **Stage run** : `nginx:alpine`.
  - Copier `dist/` → `/usr/share/nginx/html`.
  - Copier `nginx.conf` → `/etc/nginx/conf.d/default.conf`.
  - Copier `docker-entrypoint.sh` (génère `env.js`).
  - `ENTRYPOINT` : exécute l'entrypoint puis `nginx -g 'daemon off;'`.
- `HEALTHCHECK` : `wget -qO- http://localhost/` ou `/healthz` statique.

### 3. nginx → `frontend/nginx.conf`
- Racine `/usr/share/nginx/html`, **SPA fallback** : `try_files $uri /index.html`.
- **Reverse-proxy API** :
  ```
  location /api/ {
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # streaming vidéo
    proxy_request_buffering off;
    client_max_body_size 0;       # uploads/streams volumineux
  }
  ```
  (nginx transmet le header `Range` par défaut → streaming OK.)
- `env.js` servi sans cache (`location = /env.js { add_header Cache-Control "no-store"; }`).
- Assets hashés : cache long.

### 4. Entrypoint runtime config → `frontend/docker-entrypoint.sh`
Génère `/usr/share/nginx/html/env.js` depuis l'env du conteneur :
```sh
cat > /usr/share/nginx/html/env.js <<EOF
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  API_URL: "${API_URL:-/api}",
  ALLOW_SIGNUPS: "${ALLOW_SIGNUPS:-true}"
};
EOF
```
(Valeurs publiques uniquement — pas de secret côté front.)

### 5. `docker-compose.yml` (racine)
```yaml
services:
  api:
    build: ./backend
    environment:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_JWT_SECRET: ${SUPABASE_JWT_SECRET}
      MEDIA_TOKEN_SECRET: ${MEDIA_TOKEN_SECRET}
      DATA_DIR: /data
      IG_COOKIES_FILE: ${IG_COOKIES_FILE:-}
      MAX_VIDEO_MB: ${MAX_VIDEO_MB:-300}
    volumes:
      - reelgram-media:/data
      - ${IG_COOKIES_HOST_PATH:-/dev/null}:/secrets/ig_cookies.txt:ro   # optionnel
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  web:
    build:
      context: ./frontend
    environment:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      API_URL: /api
      ALLOW_SIGNUPS: ${ALLOW_SIGNUPS:-true}
    depends_on:
      - api
    ports:
      - "80"          # Coolify mappe le domaine sur ce service
    restart: unless-stopped
volumes:
  reelgram-media:
```
> Note Coolify : exposer **uniquement** `web` à un domaine ; `api` reste sur le
> réseau interne. TLS géré par le proxy Coolify (Traefik). Définir les variables
> d'env dans l'UI Coolify (ou un `.env`).

### 6. `.env.example` (compléter Spec 01)
Inclure **toutes** les variables backend + frontend + `IG_COOKIES_HOST_PATH`,
`MEDIA_TOKEN_SECRET` (générer un secret aléatoire), `MAX_VIDEO_MB`. Commentaires :
où trouver chaque valeur Supabase (Project Settings → API).

### 7. Cookies Instagram
Documenter dans le README : exporter les cookies Instagram au format Netscape
(`cookies.txt`, ex. extension navigateur), les fournir via `IG_COOKIES_HOST_PATH`
→ montés à `/secrets/ig_cookies.txt` → `IG_COOKIES_FILE=/secrets/ig_cookies.txt`.

### 8. README racine
- Présentation Réelgram.
- Prérequis : projet Supabase Cloud + migration appliquée (Spec 01).
- Dev local : `frontend` (`npm run dev`) + `backend` (`uvicorn`) + `.env`.
- Déploiement Coolify : créer une ressource « Docker Compose », pointer le repo,
  définir les variables d'env, déployer ; mapper le domaine sur `web` ; vérifier
  le volume `reelgram-media` persistant.
- Setup Raccourci iOS → renvoi vers `docs/ios-shortcut.md` (Spec 06).
- Note cookies Instagram (§7).

## Critères d'acceptation
- `docker compose build` puis `docker compose up` : `web` et `api` démarrent,
  healthchecks **healthy**.
- `https://<domaine>/` sert la PWA ; `https://<domaine>/api/health` → `{status:"ok"}`
  (via le proxy nginx, même origine).
- `env.js` reflète les variables d'env au runtime (changer une var + redéployer
  sans rebuild d'image change la config front).
- Le volume `reelgram-media` persiste les vidéos entre redéploiements.
- Le flux complet marche en prod : signup → import URL → lecture vidéo ; Raccourci
  iOS → vidéo dans le vault.
- Déploiement Coolify documenté et reproductible.
