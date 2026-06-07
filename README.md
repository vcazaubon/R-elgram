# Réelgram

Vault privé de Reels Instagram — sauvegardez, organisez et regardez vos Reels
depuis n'importe quel appareil.

**Stack :** PWA Vite + React + TypeScript (frontend) · FastAPI + yt-dlp + ffmpeg
(backend) · Supabase Cloud (auth + RLS) · vidéos stockées sur volume local ·
déploiement Docker via Coolify.

## Architecture

Deux conteneurs orchestrés par `docker-compose.yml` (à la racine) :

- **`web`** — nginx servant la PWA compilée **et** reverse-proxy `/api` →
  `api:8000`. C'est le **seul** service exposé à un domaine. nginx sert la SPA
  (fallback `try_files`) et `env.js` sans cache.
- **`api`** — FastAPI (yt-dlp + ffmpeg). Reste sur le **réseau interne** :
  jamais exposé directement, joignable uniquement via le proxy `web`.
- **Volume `reelgram-media`** — stockage persistant des vidéos et miniatures
  (`/data`), conservé entre redéploiements.

Origine unique : le front et l'API partagent le même domaine (`/` = PWA,
`/api/*` = backend), donc pas de CORS et les cookies/JWT fonctionnent
naturellement. TLS est géré par le proxy Coolify (Traefik).

La config front publique (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_URL`,
`ALLOW_SIGNUPS`) est injectée **au runtime** dans `window.__ENV__` via `env.js`
(généré par `frontend/docker-entrypoint.sh` au démarrage). La **même image**
fonctionne sur tous les environnements : changer une variable + redéployer
suffit, aucun rebuild requis.

## Prérequis

1. **Projet Supabase Cloud.** Récupérez dans *Project Settings → API* :
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon public), `SUPABASE_SERVICE_ROLE_KEY`
   (secret), et `SUPABASE_JWT_SECRET` (*JWT Secret*).
2. **Migration appliquée.** Exécutez `supabase/migrations/0001_init.sql` sur le
   projet (tables, RLS, trigger des catégories par défaut). Voir
   `supabase/migrations/README.md`.
3. **`MEDIA_TOKEN_SECRET`** — secret aléatoire **obligatoire** pour signer les
   URLs média. Générez-le avec :
   ```sh
   openssl rand -hex 32
   ```
   Sans ce secret, le streaming vidéo et les miniatures ne fonctionnent pas.

Copiez `.env.example` → `.env` et renseignez ces valeurs (le `.env` est
gitignoré — ne le committez jamais).

## Développement local

Backend (FastAPI) :
```sh
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export $(grep -v '^#' ../.env | xargs)   # charge les variables
uvicorn app.main:app --reload --port 8000
```

Frontend (Vite) :
```sh
cd frontend
npm install
npm run dev
```

Le serveur de dev Vite proxifie `/api` vers `http://localhost:8000`
(cf. `vite.config.ts`), reproduisant la topologie de prod (même origine).

Alternative tout-en-un avec Docker (reproduit exactement la prod) :
```sh
docker compose up --build   # web sur un port mappé, api interne
```

## Déploiement — Coolify depuis GitHub

La cible est un déploiement « d'un coup » depuis le repo GitHub :

1. **Poussez le repo sur GitHub** (le `docker-compose.yml` est à la racine, avec
   des build contexts relatifs `./frontend` et `./backend` — pas d'image
   pré-poussée, pas de Nixpacks).
2. Dans Coolify, créez une ressource **« Docker Compose »** et pointez-la sur le
   repo GitHub (branche de prod). Coolify lit le `docker-compose.yml` et **build
   depuis les sources**.
3. **Variables d'environnement** : définissez-les dans l'UI Coolify (toutes
   celles de `.env.example` : `SUPABASE_*`, `MEDIA_TOKEN_SECRET`, `MAX_VIDEO_MB`,
   `API_URL`, `ALLOW_SIGNUPS`, et optionnellement les cookies IG). Les secrets
   restent hors du repo.
4. **Domaine** : mappez votre domaine **sur le service `web` uniquement**.
   `api` reste interne. Coolify/Traefik gère le TLS.
5. **Déployez.** Les healthchecks doivent passer `healthy` (api : `/api/health`).
6. **Volume** : vérifiez que `reelgram-media` est bien persistant (les vidéos
   survivent aux redéploiements).

Vérifications post-déploiement :
- `https://<domaine>/` sert la PWA.
- `https://<domaine>/api/health` → `{"status":"ok"}` (via le proxy nginx, même
  origine — prouve que `web` joint `api`).
- `env.js` (`https://<domaine>/env.js`) reflète vos variables d'env.

## Installation iOS / PWA & Raccourci de partage

Voir **[`docs/ios-shortcut.md`](docs/ios-shortcut.md)** : installer la PWA sur
l'écran d'accueil et créer un Raccourci iOS pour envoyer un Reel vers le vault
depuis la feuille de partage Instagram (authentifié par un token personnel
généré dans l'app).

## Cookies Instagram (optionnel)

Certains Reels (privés, age-gated, ou rate-limités) nécessitent des cookies de
session Instagram pour que yt-dlp puisse les récupérer.

1. Exportez vos cookies Instagram au **format Netscape** (`cookies.txt`), par
   exemple via une extension navigateur « Get cookies.txt ».
2. Placez le fichier sur l'hôte et pointez `IG_COOKIES_HOST_PATH` dessus.
3. Dans `docker-compose.yml`, **décommentez** la ligne de montage du service
   `api` :
   ```yaml
   - ${IG_COOKIES_HOST_PATH}:/secrets/ig_cookies.txt:ro
   ```
4. Réglez `IG_COOKIES_FILE=/secrets/ig_cookies.txt` (chemin **dans** le
   conteneur).

Laissé désactivé par défaut (`IG_COOKIES_HOST_PATH=/dev/null`,
`IG_COOKIES_FILE` vide) pour que la stack démarre sans fichier de cookies. Sous
Coolify, montez le fichier de cookies via un *Persistent Storage* / *File mount*
et réglez `IG_COOKIES_FILE` en conséquence.

## Documentation

- **Specs** : `docs/superpowers/specs/` — commencer par
  `2026-06-07-reelgram-design.md` (data model, API, flows, variables d'env).
- **Référence visuelle** : `design-reference/` — vérité UI, **ne pas modifier**.
- **Migrations Supabase** : `supabase/migrations/`.
- **Raccourci iOS** : `docs/ios-shortcut.md`.
