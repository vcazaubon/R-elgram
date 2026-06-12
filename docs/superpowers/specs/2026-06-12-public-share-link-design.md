# Réelgram — Partage public d'un réel via URL (temporaire ou permanent)

- **Date** : 2026-06-12
- **Branche** : `feat/public-share`
- **Statut** : design validé en brainstorming, en attente de `writing-plans`

## Problème

Réelgram est aujourd'hui un **coffre privé mono-utilisateur**. Tout passe par
une authentification (Supabase JWT, biométrie), et même les fichiers média sont
servis via des **tokens HMAC court terme liés à `(video_id, user_id, exp)`**
(`backend/app/media.py`) parce que `<video>`/`<img>` ne peuvent pas envoyer de
header `Authorization`. Il n'existe **aucun chemin non authentifié**.

On veut pouvoir **partager un réel sauvegardé** (vidéo ou carrousel d'images) à
quelqu'un qui n'a pas l'app, via une **URL publique** configurable **temporaire
ou permanente**, avec un fort accent sur l'**UX mobile-first** et le **respect de
l'UI existante** (sombre, cinématique, glassmorphism).

C'est l'ajout architectural central : **introduire un chemin public isolé** sans
fragiliser le coffre privé.

## Décisions de cadrage (validées)

1. **Accès** : lien **non listé** par défaut + **mot de passe (PIN) optionnel**
   activable au cas par cas.
2. **Expiration** : presets rapides **24 h / 7 jours / 30 jours / Permanent**
   (`expires_at`, `null` = permanent). **Défaut = 7 jours** (temporaire par
   hygiène ; « Permanent » est un choix conscient).
3. **Contenu de la page publique** : **brandée Réelgram** + **titre** du réel.
   **Pas** d'auteur Instagram, **pas** de lien source, **pas** de bouton
   télécharger (lecture en streaming), **pas** de catégorie (taxonomie privée).
4. **Périmètre média** : **vidéos ET images/carrousels** (parité bibliothèque).
5. **Modèle de lien** : **N liens indépendants par réel** (ex. un permanent +
   un 24 h), chacun révocable séparément.
6. **Gestion** : **par réel** (liste de liens) **+ vue globale** « Liens
   partagés » dans Compte.
7. **Architecture** : **hybride (option C)** — le backend sert la coquille
   `/s/:slug` avec **meta OG par lien** (aperçus riches en messagerie) + un
   **bundle Vite public dédié** qui réutilise les composants player/galerie.

## Architecture

### Vue d'ensemble

```
Destinataire (non authentifié)
  │  GET /s/{slug}                      → coquille HTML (backend) + meta OG par lien
  │                                       + assets du bundle public (entrée Vite dédiée)
  │  GET /api/share/{slug}              → métadonnées + (si pas de code) view_token + URLs média
  │  POST /api/share/{slug}/unlock      → (si code) view_token après vérif du PIN
  │  GET /api/share/{slug}/stream?t=…   → flux vidéo (range)  ─┐ vérif view_token
  │  GET /api/share/{slug}/slide/{i}?t= → image de carrousel  ─┤ + état du share
  │  GET /api/share/{slug}/thumb?t=…    → vignette            ─┘ à CHAQUE requête
  │  GET /api/share/{slug}/og           → vignette OG (sans token, scopée slug)

Propriétaire (JWT)
     POST   /api/videos/{id}/shares     → créer un lien
     GET    /api/videos/{id}/shares     → liste des liens du réel
     GET    /api/shares                 → liste globale (jointe titre+vignette)
     DELETE /api/shares/{share_id}      → révoquer (soft)
```

### Isolation (point dur)

Le **bundle public** est une **entrée Vite séparée** (ex. `frontend/public-share.html`
+ `src/public/main.tsx`) qui **n'importe jamais `src/lib/supabase.ts` ni
`src/lib/auth.tsx`** : aucune session, aucun JWT, aucune biométrie ne peut fuiter
côté destinataire. Il réutilise les **composants de présentation** (le player
9:16 et la galerie swipe) en les extrayant de leurs dépendances d'auth si besoin.
Un **test garde-fou** vérifie que le bundle public compilé ne contient pas le
client Supabase.

### Routage déploiement

nginx (conteneur Coolify) route `/s/*` et `/api/share/*` vers le backend FastAPI.
Le backend rend la coquille `/s/:slug` (meta OG injectées par lien) et sert les
assets du bundle public. Nouvelle variable `PUBLIC_BASE_URL` (ex.
`https://reelgram.app`) pour construire les URLs de partage renvoyées au client.

## Modèle de données

Nouvelle migration **`supabase/migrations/0005_shares.sql`** :

```sql
create table if not exists public.shares (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references public.videos(id) on delete cascade,
  user_id        uuid not null references auth.users(id)   on delete cascade,
  slug           text not null unique,        -- capability publique, ~22 car. base62 (≥128 bits)
  password_hash  text,                         -- null = pas de code ; sinon argon2
  expires_at     timestamptz,                  -- null = permanent
  revoked_at     timestamptz,                  -- null = actif
  view_count     int  not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists shares_user_created_idx on public.shares (user_id, created_at desc);
create index if not exists shares_video_idx        on public.shares (video_id);
-- slug déjà unique (contrainte)

alter table public.shares enable row level security;
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- **`on delete cascade` depuis `videos`** : supprimer un réel tue tous ses liens
  (invariant : jamais de lien orphelin vers un fichier purgé).
- **RLS** : CRUD authentifié strictement propriétaire. Les **lectures publiques
  passent par le service-role** côté backend (comme les lectures vidéo
  actuelles), **jamais** par RLS, et **toujours scopées par la ligne `share`**
  (slug → `video_id` + `user_id`). On ne fait **jamais** confiance à un
  `video_id` venu du client sur un chemin public.

## Contrat API

### Routes authentifiées (JWT, propriétaire)

- **`POST /api/videos/{id}/shares`**
  Corps : `{ "expires_in": "24h" | "7d" | "30d" | null, "password": "1234" | null }`.
  Vérifie que le réel appartient à l'utilisateur **et** que `status == "ready"`
  (interdit de partager un réel encore en ingestion). Calcule `expires_at`,
  génère un `slug` unique, hache le PIN s'il y en a un.
  Réponse `201` : `{ "slug", "url", "expires_at", "has_password" }`
  (`url = PUBLIC_BASE_URL + "/s/" + slug`). Le PIN n'est **jamais** ré-émis.

- **`GET /api/videos/{id}/shares`** → liste des liens du réel :
  `[{ "id", "slug", "url", "status", "expires_at", "has_password", "view_count", "created_at" }]`
  où `status ∈ {active, expired, revoked}` (calculé).

- **`GET /api/shares`** → liste globale (tous réels), jointe au réel pour la vue
  Compte : `[{ "id", "url", "status", "expires_at", "view_count", "video": { "id", "title", "thumb_color", "media_type" } }]`.

- **`DELETE /api/shares/{share_id}`** → révocation **soft** (`revoked_at = now()`),
  `204`. La ligne est conservée (historique + vues).

V1 : **pas de `PATCH`**. Reconfigurer = révoquer + recréer (cohérent avec « N
liens par réel »).

### Routes publiques (aucun JWT)

- **`GET /s/{slug}`** → coquille HTML rendue par le backend, avec meta OG par
  lien (voir § OG) + montage du bundle public.

- **`GET /api/share/{slug}`** → résolution des métadonnées :
  `{ "media_type", "title", "needs_password": bool, "expires_at" }`.
  - Si **pas** de mot de passe : renvoie aussi `view_token` + URLs média
    (`stream_url` ou `slides[]`, `thumb_url`).
  - Si **mot de passe** : `needs_password: true`, **aucun token**, **aucune URL
    média**.
  - Incrémente `view_count` et met à jour `last_viewed_at` (= nb d'ouvertures).
  - Share révoqué/expiré → **410 Gone**.

- **`POST /api/share/{slug}/unlock`** `{ "password": "…" }` → vérif argon2 à temps
  constant, **rate-limité par slug + IP** (ex. 5 essais / 15 min → 429). Succès :
  `view_token` + URLs média. Échec : `403`.

- **`GET /api/share/{slug}/stream?t=…`**, **`/slide/{i}?t=…`**, **`/thumb?t=…`**
  → servent le média **après** vérif du `view_token` (lié `slug + exp`, ~1 h) et
  de l'état du share (non révoqué, non expiré) à **chaque** requête. Réutilise
  `media.stream_file` (range HTTP). Token/état invalide → 403/410.

- **`GET /api/share/{slug}/og`** → vignette pour l'aperçu de lien, **sans token**
  (scopée par slug), **uniquement si le lien n'a pas de code** (voir § OG).

## Tokens & sécurité

- **Slug** = la capability : ≥128 bits aléatoires, base62 (~22 car.),
  non devinable. Collision → regénérer.
- **`view_token`** : variante HMAC dans `media.py`, liée `(slug, exp)` (et non
  plus à `user_id`). Signé avec le secret existant (`MEDIA_TOKEN_SECRET`) ou un
  secret dédié `SHARE_TOKEN_SECRET` (préféré : séparation des domaines).
- **Mot de passe** : **argon2**, jamais stocké en clair, vérif à temps constant ;
  `unlock` rate-limité par slug+IP contre le brute-force.
- **Expiration/révocation** vérifiées **serveur** à chaque requête publique
  (métadonnées **et** média) → 410 + page « Lien inactif ».
- **Bande passante** : média servi depuis la box → rate-limit basique par IP sur
  les routes publiques (token-bucket applicatif ou nginx). À surveiller, non
  bloquant en V1.

### Aperçu de lien (OG) — nuance de fuite

- Lien **sans code** : `og:title` = titre, `og:image` = `/api/share/{slug}/og`
  (vignette réelle, basse sensibilité — le slug est la capability). `og:type`
  video pour une vidéo.
- Lien **protégé par code** : OG **générique** (logo Réelgram + « Réel
  protégé »), **jamais** la vignette réelle — sinon l'aperçu fuiterait l'image
  avant la saisie du code. `/og` renvoie alors un placeholder ou 404.

## UX / UI

Maquettes de référence (locales, non versionnées) :
`.superpowers/brainstorm/2739014-1781243717/content/` —
`entry-point.html`, `config-sheet.html`, `links-management.html`,
`public-page.html`.

### Point d'entrée (option B — changement minimal)

La **barre d'action du player reste inchangée** (`Lire · Renommer · Catégorie ·
Supprimer`). Le **menu `⋯`** (haut-droite du `PlayerScreen`, aujourd'hui un
placeholder dans `MediaActionSheet` type `more`) accueille **« Partager » en
tête**. Même logique sur la **carte de la bibliothèque** (appui long) et dans la
**galerie d'images**.

### Sheet « Partager » (calqué sur `MediaActionSheet`)

Bottom sheet (coins 26px, poignée, surfaces sombres), deux états :

1. **Configurer** : label « Durée du lien » + 4 chips (`24 h` / **`7 jours`**
   présélectionné / `30 jours` / `Permanent`) ; toggle « Protéger par un code »
   (off par défaut, révèle un champ PIN) ; bouton **« Créer le lien »**.
2. **Lien prêt** : pastille d'URL copiable, rappel d'expiration (« Expire le
   19 juin · sans code »), bouton principal **« Partager… »** qui ouvre le
   **menu de partage natif** (`navigator.share`, avec repli copier-presse-papier),
   bouton secondaire « Copier le lien », lien « Gérer les liens de ce réel → ».

### Gestion par réel (liste)

« Liens de ce réel » : chaque lien = **pastille de statut colorée** (violet =
Permanent, ambre = expire bientôt, vert = encore du temps), **nombre de vues**,
**cadenas** si protégé, actions par ligne **copier** + **révoquer** (corbeille,
avec confirmation). En bas : **« ＋ Nouveau lien »** rouvre l'étape configurer.

### Vue globale (Compte → « Liens partagés »)

Écran liste : compteur « N actifs », chaque ligne = vignette du réel + titre +
statut + vues + révocation rapide. Tableau de bord de tout ce qui est exposé. Le
code couleur des statuts est cohérent partout.

### Page publique du destinataire (bundle public)

Page web autonome, brandée, mobile-first. 4 états :

1. **Vidéo** : wordmark Réelgram (dégradé), scène 9:16 lecture + scrub (réutilise
   le player), titre, footer « Partagé via Réelgram · Ouvrir l'app → ».
2. **Carrousel** : même chrome, pastille d'index « 1 / N » + points de
   pagination en swipe (réutilise `GalleryScreen`).
3. **Code requis** : carte centrée cadenas, saisie PIN, « Voir le réel ».
4. **Lien inactif** : état amical (expiré/révoqué) + CTA découverte.

## Cycle de vie

- **Expiration** : *lazy*, calculée à chaque accès — pas de cron requis. Purge
  optionnelle des lignes mortes plus tard.
- **Révocation** : soft (`revoked_at`), effet immédiat.
- **Suppression du réel** : cascade FK → tous les liens meurent.
- **Compteur de vues** : incrémenté à la résolution des métadonnées (= nombre
  d'ouvertures ; légère sur-estimation assumée).

## Cas limites

- Collision de slug → regénérer.
- `view_token` expiré en plein stream → le `<video>` redemande une URL (re-résout).
- Fichier média disparu → 404.
- Réel pas encore `ready` → création de lien interdite (400).
- Tentatives de PIN répétées → 429 (rate-limit).
- Réel supprimé alors qu'un lien est ouvert → 410 au prochain accès.

## Tests

**Backend (pytest)** :
- CRUD `shares` + RLS propriétaire (un user ne voit/révoque pas les liens d'un autre).
- Résolution publique scopée par slug ; refus de tout `video_id` client.
- Expiration & révocation → 410 ; création interdite si réel non `ready`.
- `unlock` succès/échec + rate-limit ; argon2 (pas de clair en base).
- OG : vignette réelle si sans code, générique/404 si protégé.
- Cascade : suppression du réel → liens supprimés.
- `view_token` lié au slug (un token d'un slug ne marche pas pour un autre).

**Frontend (vitest)** :
- Logique du sheet : presets → `expires_in`, toggle code → payload.
- Mapping statut → libellé/couleur (active/expired/revoked, « expire dans … »).
- Rendu du bundle public : vidéo, carrousel, gate code, état inactif.
- **Test d'isolation** : le bundle public ne référence pas le client Supabase /
  le module d'auth.

## Configuration & déploiement

- Nouvelles vars : `PUBLIC_BASE_URL`, `SHARE_TOKEN_SECRET` (ou réutilise
  `MEDIA_TOKEN_SECRET`). Documenter dans `.env.example`.
- nginx : router `/s/*` et `/api/share/*` vers le backend ; servir les assets du
  bundle public.
- Build Vite : ajouter l'entrée publique (`build.rollupOptions.input`).

## Hors périmètre (YAGNI V1)

- Édition d'un lien existant (`PATCH`) — on révoque + recrée.
- Expiration par **nombre de vues** (éphémère type Snapchat) — uniquement durée.
- QR code, analytics avancées (référents, géo), notifications de consultation.
- Attribution/lien Instagram source, bouton télécharger.
- Purge planifiée des liens expirés (lazy suffit en V1).
