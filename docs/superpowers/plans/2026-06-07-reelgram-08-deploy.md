# Réelgram Spec 08 — Docker & Coolify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Vérif = `docker compose build` + smoke test de topologie réel (daemon Docker dispo). Steps en `- [ ]`.

**Goal:** Rendre Réelgram déployable d'un coup sur Coolify depuis un repo GitHub : `web` (nginx servant la PWA + reverse-proxy `/api`) + `api` (FastAPI) + volume persistant `reelgram-media`. Healthchecks, config runtime (env.js), README + guide cookies.

**Architecture:** Coolify-first depuis GitHub : `docker-compose.yml` à la racine, build depuis les sources (contexts `./frontend`, `./backend`). Seul `web` est exposé à un domaine ; `api` reste interne. TLS géré par le proxy Coolify. Config front publique injectée au runtime via `env.js` (entrypoint), pas de rebuild par environnement.

**Tech Stack:** Docker, docker-compose, nginx:alpine, python:3.12-slim, node:20-alpine.

---

## File Structure
- `backend/Dockerfile` — python:3.12-slim + ffmpeg + deps + uvicorn + healthcheck.
- `frontend/Dockerfile` — multi-stage node build → nginx:alpine + entrypoint.
- `frontend/nginx.conf` — SPA fallback + `/api` proxy + env.js no-cache.
- `frontend/docker-entrypoint.sh` — génère `env.js` depuis l'env.
- `docker-compose.yml` (racine) — services api/web + volume.
- `.env.example` (compléter), `README.md` (compléter), note cookies IG.

---

## Task 1: Backend Dockerfile
**Files:** Create `backend/Dockerfile`, `backend/.dockerignore`
- [ ] **Step 1:** `backend/Dockerfile` :
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
`backend/.dockerignore` : `.venv`, `tests`, `__pycache__`, `*.pyc`.
- [ ] **Step 2: build verify** `cd /opt/Réelgram && docker build -t reelgram-api ./backend` → succès (image construite). **Commit** "Spec 08 T1: backend Dockerfile".

## Task 2: Frontend Dockerfile + nginx + entrypoint
**Files:** Create `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/docker-entrypoint.sh`, `frontend/.dockerignore`
- [ ] **Step 1:** `frontend/Dockerfile` (multi-stage) :
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:alpine
RUN apk add --no-cache wget
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-reelgram-env.sh
RUN chmod +x /docker-entrypoint.d/40-reelgram-env.sh
```
(nginx:alpine exécute `/docker-entrypoint.d/*.sh` au démarrage → génère env.js avant nginx.)
- [ ] **Step 2:** `frontend/docker-entrypoint.sh` :
```sh
#!/bin/sh
set -e
cat > /usr/share/nginx/html/env.js <<EOF
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  API_URL: "${API_URL:-/api}",
  ALLOW_SIGNUPS: "${ALLOW_SIGNUPS:-true}"
};
EOF
```
- [ ] **Step 3:** `frontend/nginx.conf` :
```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  location = /env.js { add_header Cache-Control "no-store"; }
  location /api/ {
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
    client_max_body_size 0;
  }
  location / { try_files $uri /index.html; }
}
```
`frontend/.dockerignore` : `node_modules`, `dist`, `.vite`.
- [ ] **Step 4: build verify** `docker build -t reelgram-web ./frontend` → succès. **Commit** "Spec 08 T2: frontend Dockerfile + nginx + entrypoint".

## Task 3: docker-compose + .env.example + README + cookies
**Files:** Create `docker-compose.yml`; Modify `.env.example`, `README.md`; (cookies doc dans README)
- [ ] **Step 1:** `docker-compose.yml` :
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
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  web:
    build: ./frontend
    environment:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      API_URL: /api
      ALLOW_SIGNUPS: ${ALLOW_SIGNUPS:-true}
    depends_on:
      - api
    ports:
      - "80"
    restart: unless-stopped
volumes:
  reelgram-media:
```
(Cookies IG optionnels : documenter le montage `- ${IG_COOKIES_HOST_PATH}:/secrets/ig_cookies.txt:ro` en commentaire, désactivé par défaut pour ne pas casser le build sans fichier.)
- [ ] **Step 2:** Compléter `.env.example` (déjà créé en Spec 01) si une variable manque (toutes les vars compose : SUPABASE_*, MEDIA_TOKEN_SECRET, MAX_VIDEO_MB, IG_COOKIES_FILE, IG_COOKIES_HOST_PATH, API_URL, ALLOW_SIGNUPS).
- [ ] **Step 3:** Compléter `README.md` racine : présentation, prérequis (projet Supabase + migration `supabase/migrations/0001_init.sql` appliquée), dev local (frontend `npm run dev` + backend `uvicorn` + proxy), déploiement **Coolify depuis GitHub** (ressource Docker Compose → repo → variables d'env dans l'UI → déployer → domaine sur `web` → volume `reelgram-media` persistant), setup Raccourci iOS (renvoi `docs/ios-shortcut.md`), note cookies Instagram (export cookies.txt Netscape → `IG_COOKIES_HOST_PATH` monté sur `/secrets/ig_cookies.txt` → `IG_COOKIES_FILE`), rappel `MEDIA_TOKEN_SECRET` obligatoire (`openssl rand -hex 32`).
- [ ] **Step 4: compose validate** `docker compose config >/dev/null && echo COMPOSE_OK`. **Commit** "Spec 08 T3: docker-compose + .env.example + README + cookies".

## Task 4: Vérification d'intégration (build + smoke test topologie)
**Files:** none (vérif)
- [ ] **Step 1: build complet** `cd /opt/Réelgram && docker compose build` → les 2 images se construisent (peut prendre plusieurs minutes : ffmpeg + yt-dlp + npm). Utilise un timeout long.
- [ ] **Step 2: smoke test** créer un `.env` jetable avec des valeurs factices non vides (`MEDIA_TOKEN_SECRET=test`, SUPABASE_* = placeholders) pour éviter les warnings, puis :
```
docker compose up -d
# attendre que l'api soit healthy (boucle sur: docker compose ps)
docker compose exec -T web wget -qO- http://localhost/api/health   # attendu: {"status":"ok"}
docker compose exec -T web wget -qO- http://localhost/ | grep -qi '<div id="root"' && echo "SPA OK"
docker compose down -v
rm -f .env   # ne pas committer le .env jetable
```
Attendu : `/api/health` renvoie `{"status":"ok"}` **via le proxy nginx** (prouve web→api), et la SPA est servie. C'est la validation end-to-end de la topologie.
- [ ] **Step 3:** Si tout est vert, **commit** (si des ajustements ont été nécessaires) ; sinon rien à committer. Documenter la sortie du smoke test.

---

## Self-Review
- **Spec coverage :** backend Dockerfile+ffmpeg+health (T1) ✓ · frontend multi-stage nginx+entrypoint env.js (T2) ✓ · nginx SPA+proxy /api+env.js no-cache (T2) ✓ · compose api interne/web exposé/volume/healthchecks (T3) ✓ · .env.example complet (T3) ✓ · README Coolify-from-GitHub + cookies + iOS (T3) ✓ · vérif build + smoke topologie (T4) ✓.
- **Placeholders :** Dockerfiles/nginx/compose/entrypoint fournis en entier. README décrit précisément. Pas de TODO.
- **Type consistency :** noms d'env identiques entre compose, entrypoint, `.env.example`, et le code (`config.ts` front → SUPABASE_URL/ANON_KEY/API_URL/ALLOW_SIGNUPS ; `config.py` back → SUPABASE_*/MEDIA_TOKEN_SECRET/DATA_DIR/IG_COOKIES_FILE/MAX_VIDEO_MB). Service `api` joignable en `http://api:8000` depuis nginx (même réseau compose).
