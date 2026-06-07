# Réelgram — Design maître & contrats partagés

> Document de référence pour tout le pack de specs. Chaque spec (`01`…`07`) s'y
> réfère pour le data model, le contrat d'API, les variables d'environnement et
> la structure du repo. **Lis ce document en premier.**

_Date : 2026-06-07 — Auteur : brainstorming Réelgram_

---

## 1. Produit

**Réelgram** est un *vault privé* de Reels Instagram. L'utilisateur partage une
URL Instagram (depuis l'app ou via un Raccourci iOS) ; le backend récupère la
vidéo avec **yt-dlp**, génère une miniature, et la range dans une bibliothèque
privée, classée par catégories. **Pas de social, pas de feed, pas de likes.**
Mobile-first, dark mode, premium, installable (PWA).

Source de vérité visuelle : `design-reference/` (bundle Claude Design exporté).
Le rendu doit être **pixel-perfect** par rapport à `design-reference/project/`.
On garde `styles.css` (tokens) verbatim et on porte les `*.jsx` du prototype en
React/TypeScript propre.

### Écrans (cf. `design-reference/project/`)
| Écran | Fichier proto | Rôle |
|-------|---------------|------|
| Login / unlock | `screens-login.jsx` | Porte d'entrée (email/mdp + Face ID) |
| Bibliothèque | `screens-main.jsx` → `LibraryScreen` | Cards immersives, recherche, filtres, FAB |
| Écran vide | `screens-main.jsx` → `EmptyScreen` | 3 étapes, CTA |
| Catégories | `screens-main.jsx` → `CategoriesScreen` | CRUD catégories |
| Import | `screens-import.jsx` | Form URL + catégorie + progression 4 étapes + erreur |
| Lecteur | `screens-player.jsx` | Lecteur 9:16 cinématique + bottom sheets |
| Design Direction | `screens-direction.jsx` | Showcase du design system (**optionnel**, basse priorité) |

---

## 2. Décisions d'architecture (verrouillées)

| Sujet | Décision |
|-------|----------|
| Supabase | **Supabase Cloud** (managé) — auth + Postgres + RLS |
| Auth | **Email + mot de passe** (`signInWithPassword`/`signUp`) + couche **Face ID** (WebAuthn, verrou biométrique par-dessus la session de la PWA installée) |
| Multi-user | **Oui** — chaque compte isolé par **RLS** (`user_id = auth.uid()`) |
| Backend | **Python / FastAPI** + **yt-dlp** + **ffmpeg** |
| Récup vidéo | yt-dlp, avec **support des cookies de session Instagram** |
| Stockage vidéo | **Local**, sur un **volume Docker** (`/data`), servi par le backend en HTTP range derrière auth |
| Miniatures | **Réelles**, générées par ffmpeg ; le dégradé du mockup devient le glow ambiant / fallback |
| Ingestion iOS | `POST /api/ingest` authentifié par **token personnel** (`api_tokens`) → Raccourci iOS |
| Déploiement | **Docker + Coolify** ; `web` (nginx : SPA + reverse-proxy `/api`) + `api` (FastAPI) + volume `reelgram-media` |
| Routing front | **State-based** (comme le proto `pwa-app.jsx`), pas de react-router — full-screen app |

### Frontend ↔ Backend : deux chemins
- **Lectures + CRUD métadonnées** (lister/filtrer/chercher vidéos, renommer,
  recatégoriser, supprimer, CRUD catégories) → **client Supabase JS direct**, RLS.
- **Ingestion + lecture du fichier vidéo** → **backend** (seul à avoir
  yt-dlp/ffmpeg + le volume). Le backend valide le JWT, télécharge, écrit la row
  en **service role**, sert le fichier.

### Réseau / origine unique
`web` (nginx) sert la SPA **et** reverse-proxy `location /api/ → http://api:8000`.
Tout est **same-origin** : pas de CORS, le frontend appelle `/api/...`. Le
service `api` reste **interne** au réseau Docker (pas exposé directement). Le
Raccourci iOS tape `https://<ton-domaine>/api/ingest`.

---

## 3. Structure du repo (cible)

```
/opt/Réelgram/
├── design-reference/          # bundle Claude Design (source de vérité visuelle) — NE PAS modifier
├── docs/superpowers/specs/    # ce pack de specs
├── frontend/                  # Vite + React + TS (PWA)
│   ├── src/
│   │   ├── lib/               # supabase client, api client, runtime config, webauthn
│   │   ├── components/        # composants partagés portés (Icons, Thumb, VideoCard, TabBar, StatusBar, boutons)
│   │   ├── screens/           # Login, Library, Empty, Categories, Import, Player, (Direction)
│   │   ├── styles.css         # copié verbatim de design-reference/project/styles.css (+ app shell pwa)
│   │   ├── App.tsx            # router state + guard
│   │   └── main.tsx
│   ├── public/                # manifest, icônes (depuis design-reference/project/pwa)
│   ├── index.html
│   ├── vite.config.ts         # + vite-plugin-pwa
│   ├── nginx.conf
│   ├── docker-entrypoint.sh   # génère /usr/share/nginx/html/env.js depuis l'env
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── backend/                   # FastAPI + yt-dlp + ffmpeg
│   ├── app/
│   │   ├── main.py            # FastAPI app, routes, health
│   │   ├── auth.py            # vérif JWT Supabase + token perso
│   │   ├── ingest.py          # job yt-dlp + ffmpeg + statut
│   │   ├── media.py           # stream range + thumb + signed media token
│   │   ├── tokens.py          # CRUD api_tokens
│   │   ├── supa.py            # client supabase (service role)
│   │   ├── config.py          # settings (env)
│   │   └── models.py          # schémas pydantic
│   ├── requirements.txt
│   └── Dockerfile
├── supabase/
│   └── migrations/            # SQL (tables, RLS, trigger catégories par défaut)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 4. Data model (Supabase Postgres)

Toutes les tables : RLS activée, policies `user_id = auth.uid()` (select/insert/update/delete).
Le backend écrit en **service role** (bypass RLS) et fixe `user_id` depuis le JWT/token validé.

```sql
-- categories
id           uuid pk default gen_random_uuid()
user_id      uuid not null references auth.users(id) on delete cascade
label        text not null
color        text not null default '#a78bfa'      -- hex accent (cf. tokens)
position     int  not null default 0
created_at   timestamptz not null default now()

-- videos
id               uuid pk default gen_random_uuid()
user_id          uuid not null references auth.users(id) on delete cascade
category_id      uuid references categories(id) on delete set null
source_url       text not null
title            text not null default 'Sans titre'
author           text                                  -- "@handle"
duration_seconds int
thumb_color      text default '#a78bfa'                -- couleur dominante extraite (glow/fallback)
status           text not null default 'analyzing'     -- analyzing|fetching|thumbnailing|ready|error
error            text
storage_path     text                                  -- chemin relatif dans /data (ex: videos/<uid>/<vid>.mp4)
thumb_path       text                                  -- ex: thumbs/<uid>/<vid>.jpg
created_at       timestamptz not null default now()

-- api_tokens (pour le Raccourci iOS)
id            uuid pk default gen_random_uuid()
user_id       uuid not null references auth.users(id) on delete cascade
token_hash    text not null unique                     -- sha256(token plaintext)
label         text not null default 'Raccourci iOS'
created_at    timestamptz not null default now()
last_used_at  timestamptz
```

### Catégories par défaut (seedées à la création du compte, via trigger `on auth.users`)
| label | color | position |
|-------|-------|----------|
| À revoir | `#ff9966` | 0 |
| Inspiration | `#a78bfa` | 1 |
| Muscu | `#5ee2a0` | 2 |
| Business | `#5fa8ff` | 3 |
| Humour | `#ffd166` | 4 |
| Idées | `#ff7eb3` | 5 |

---

## 5. Contrat d'API (backend FastAPI, monté sous `/api`)

Auth : `Authorization: Bearer <supabase_jwt>` **ou** `X-Reelgram-Token: <token perso>`
(selon l'endpoint). Le backend résout le `user_id` et l'applique partout.

| Méthode | Route | Auth | Body / Params | Réponse |
|---------|-------|------|---------------|---------|
| GET  | `/api/health` | — | — | `{ "status": "ok" }` |
| POST | `/api/ingest` | JWT **ou** token | `{ url, category_id? }` | `{ id, status }` (crée la row `videos`, lance le job async) |
| GET  | `/api/ingest/{id}/status` | JWT ou token | — | `{ status, step, error }` (`step` 0–3) |
| GET  | `/api/videos/{id}/media-url` | JWT | — | `{ stream_url, thumb_url }` (URLs signées, ~1h) |
| GET  | `/api/videos/{id}/stream` | **media token** (`?t=`) | Range supporté | flux vidéo (206 Partial Content) |
| GET  | `/api/videos/{id}/thumb` | **media token** (`?t=`) | — | image jpeg |
| GET  | `/api/tokens` | JWT | — | `[{ id, label, created_at, last_used_at }]` |
| POST | `/api/tokens` | JWT | `{ label? }` | `{ id, token }` (**plaintext renvoyé une seule fois**) |
| DELETE | `/api/tokens/{id}` | JWT | — | `204` |

**Media token signé** : HMAC-SHA256 de `(video_id, user_id, exp)` avec
`MEDIA_TOKEN_SECRET`, encodé en base64url, passé en `?t=`. Permet à `<video>` et
`<img>` de charger le média sans header Authorization (que les media elements
n'envoient pas). Validé par le backend sur `/stream` et `/thumb`.

### Mapping statut → étapes de l'écran Import
| `status` | `step` | Libellé (design) |
|----------|--------|------------------|
| `analyzing` | 0 | Analyse du lien |
| `fetching` | 1 | Récupération de la vidéo |
| `thumbnailing` | 2 | Création de la miniature |
| `ready` | 3 | Vidéo sauvegardée |
| `error` | — | Impossible de récupérer cette vidéo |

---

## 6. Contrat de variables d'environnement

### Frontend — **runtime** (injectées dans `window.__ENV__` via `env.js`, valeurs publiques)
| Var | Exemple | Rôle |
|-----|---------|------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | URL projet Supabase |
| `SUPABASE_ANON_KEY` | `eyJ...` | clé anon publique |
| `API_URL` | `/api` | base de l'API (same-origin) |
| `ALLOW_SIGNUPS` | `true` | affiche/masque l'UI d'inscription |

> Injection runtime (et non `VITE_` build-time) pour que **la même image** marche
> sur tous les environnements Coolify sans rebuild. Un `docker-entrypoint.sh`
> écrit `env.js` (`window.__ENV__ = {...}`) au démarrage du conteneur ; `index.html`
> charge `env.js` avant le bundle.

### Backend
| Var | Rôle |
|-----|------|
| `SUPABASE_URL` | URL projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | écriture des rows (bypass RLS) |
| `SUPABASE_JWT_SECRET` | vérif des JWT (HS256) émis par Supabase |
| `MEDIA_TOKEN_SECRET` | HMAC des URLs média signées |
| `DATA_DIR` | racine du stockage (défaut `/data`) |
| `IG_COOKIES_FILE` | chemin vers cookies.txt Instagram (optionnel) |
| `MAX_VIDEO_MB` | garde-fou taille (défaut `300`) |

`.env.example` documente tout (cf. Spec 07).

---

## 7. Pack de specs & ordre d'exécution (superauto, séquentiel)

| # | Spec | Dépend de |
|---|------|-----------|
| 01 | Foundation, schéma Supabase, env, repo, types partagés | — |
| 02 | Backend ingestion (FastAPI + yt-dlp + ffmpeg + média + tokens) | 01 |
| 03 | PWA shell & design system (Vite+React+TS, tokens, composants, manifest/SW, données mock) | 01 |
| 04 | Auth (email/mdp + Face ID WebAuthn + guard + isolation) | 01, 03 |
| 05 | Bibliothèque / Catégories / Lecteur (Supabase CRUD + lecture via backend) + feuille Compte | 02, 03, 04 |
| 06 | Flux Import + Raccourci iOS (ingest + progression + token UI) | 02, 04, 05 |
| 07 | Docker & Coolify (Dockerfiles, compose, nginx proxy, healthchecks, README) | 02, 03 |

### Critères de succès globaux
1. `docker compose up` lance `web` + `api` ; `web` sert la PWA ; `/api/health` répond.
2. Inscription/connexion email-mdp fonctionne ; chaque compte ne voit que ses données (RLS).
3. Coller une URL Insta dans l'app → progression 4 étapes → vidéo lisible dans le lecteur.
4. Le Raccourci iOS POST une URL → la vidéo apparaît dans le vault du bon compte.
5. Rendu **pixel-perfect** vs `design-reference/`.
6. Déployable sur Coolify via `docker-compose.yml` (volume persistant pour les vidéos).
