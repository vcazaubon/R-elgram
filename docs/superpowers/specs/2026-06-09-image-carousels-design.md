# Réelgram — Accepter les publications à images (photos & carrousels)

- **Date** : 2026-06-09
- **Branche** : `feat/image-carousels`
- **Statut** : design validé, en attente de relecture utilisateur avant `writing-plans`

## Problème

Réelgram n'ingère aujourd'hui que les **Reels** (vidéo unique). Toute publication
Instagram contenant des **images** — photo seule, ou **carrousel** (plusieurs
slides qu'on swipe) — finit en `status='error'`. Cause : `ingest._download`
appelle yt-dlp avec `noplaylist:True` et un format **vidéo uniquement**
(`bv*[vcodec^=avc1]+ba…`) ; un post image ne propose aucun flux vidéo → l'étape
échoue → la ligne bascule en erreur.

## Objectif & périmètre

Accepter les **photos seules** et les **carrousels d'images**, avec un
visualiseur « swipe ». Décisions de cadrage validées :

| Sujet | Décision |
|---|---|
| Périmètre | Image seule + carrousel **d'images**. La vidéo dans le swipe est **hors périmètre**. |
| Carrousel **mixte** (photos + vidéo) | On **garde les photos**, on **ignore les slides vidéo** (jamais d'échec). |
| Extracteur | **gallery-dl** (robuste sur les images Instagram) classe le post et fournit les URLs ; yt-dlp reste pour la vidéo. |
| Modèle de données | Léger : 2 colonnes sur `videos` (`media_type` + `media` jsonb). **Pas** de table `media_items`. |
| Affichage d'une photo | **« Image entière »** (contain) sur fond flou ambiant. Jamais recadrée. |
| Carte de bibliothèque | Badge **compteur** « ⧉ N » à la place de la durée ; pas de bouton play. |

Ce qui **ne bouge pas** : auth/JWT, RLS, tokens média signés, suppression
(Spec 06), temps réel, partage iOS / `POST /api/ingest`.

## 1. Modèle de données — migration `supabase/migrations/0004_media_carousel.sql`

```sql
-- Réelgram — publications à images (photos & carrousels)
alter table public.videos
  add column if not exists media_type text not null default 'video'
    check (media_type in ('video','image'));
alter table public.videos
  add column if not exists media jsonb;   -- null pour une vidéo ; tableau ordonné pour un post image
```

- Rétro-compatible : les lignes existantes prennent `media_type='video'` et
  `media=null` → comportement inchangé.
- `media` (post image) = tableau ordonné :
  `[{ "i":0, "path":"<user_id>/<video_id>/0.jpg", "w":1080, "h":1350 }, …]`.
  `w`/`h` servent à dimensionner le cadre (éviter le saut de layout) — pas au
  recadrage (on est en « contain »).
- `storage_path` / `thumb_path` pointent sur la **slide 0** (couverture) → la
  carte de biblio, le temps réel (`subscribeVideos`) et la suppression
  fonctionnent **sans modification** (le purge `DELETE` retire déjà
  `storage_path` + `thumb_path` ; voir §6 pour les slides 1..N).
- La contrainte `status` reste **inchangée**
  (`analyzing/fetching/thumbnailing/ready/error`).

## 2. Ingestion — `backend/app/ingest.py`

`run_ingest` gagne une étape de **classification** en tête, puis bifurque.

### Classification

- URL `/reel/…`, `/reels/…` ou `/tv/…` → **flux vidéo actuel** (yt-dlp,
  pipeline inchangé). Pas d'appel gallery-dl (un reel est toujours une vidéo).
- URL `/p/…` (ou forme inconnue) → **gallery-dl en extraction seule** :
  `gallery-dl -j --cookies <IG_COOKIES_FILE> <url>` exécuté dans un thread
  (`asyncio.to_thread`), comme yt-dlp/ffmpeg, et **isolé dans un helper privé
  mockable** (cf. la convention « external binaries » du module). Sortie JSON
  parsée en liste ordonnée de slides : chacune a une URL média, un type
  (`image` / `video`) et les métadonnées du post (auteur, légende, date).

### Branche image (≥ 1 slide photo)

1. `media_type='image'`. On **filtre les slides vidéo** (décision mixte).
2. Téléchargement de chaque slide image via **httpx** (déjà dépendance) vers
   `settings.abs_path("<user_id>/<video_id>/<i>.<ext>")` où `<ext>` est
   l'extension d'origine (jpg/webp — pas de re-encodage). Réutilise le schéma de
   chemins existant ; helper de téléchargement mockable en test.
3. Vignette (`thumb_path`) + couleur dominante = **ffmpeg sur la slide 0**.
   ffmpeg lit une image fixe : on réutilise `_thumbnail`/`_dominant_color` en
   **retirant le `-ss 1`** sur le chemin image (pas de seek sur une image).
4. `storage_path` = chemin de la slide 0. `media` = tableau des slides
   (`i`, `path`, `w`, `h`). Métadonnées (titre/auteur/date/légende) via les
   extracteurs existants alimentés par les métadonnées gallery-dl
   (`_resolve_title`, `_extract_author`, `_extract_published_at`, `_extract_caption`).
5. Transitions : `fetching` (téléchargement des slides) → `thumbnailing`
   (vignette slide 0) → `ready`.

### Branche vidéo (0 slide photo) & secours

- Post 100 % vidéo (gallery-dl ne renvoie que des slides vidéo) → **flux vidéo
  actuel** sur l'URL (le `noplaylist:True` de yt-dlp prend la vidéo lisible).
- gallery-dl échoue (cookies absents/expirés, post indisponible, format
  inattendu) → on **retente le flux vidéo** en secours ; si ça échoue aussi →
  `status='error'` avec message clair. Aucune exception ne s'échappe de
  `run_ingest` (le statut reste la source de vérité).
- Annulation (`asyncio.CancelledError`, Spec 06) : propagée telle quelle, sans
  réécrire fichier ni statut (comportement actuel conservé).

## 3. Service média — `backend/app/main.py` & `backend/app/media.py`

Le token signé est lié au triplet `(video_id, user_id, exp)` (pas à un chemin) →
**un seul token couvre toutes les slides** d'un post.

- **Nouvelle route** `GET /api/videos/{id}/slide/{i}?t=…` : vérifie le token
  (lié à `video_id`), borne `i` sur `len(media)`, sert `media[i].path` via
  `stream_file` avec le **content-type dérivé de l'extension** (`image/jpeg`
  ou `image/webp`) (404 si fichier absent / hors borne).
- **`GET /api/videos/{id}/media-url`** enrichi (modèle `MediaUrls`) :
  - renvoie `media_type` ;
  - pour une vidéo : `stream_url` (inchangé) ;
  - pour un post image : `slides: ["/api/videos/{id}/slide/0?t=…", …]`
    (une URL signée par slide) ;
  - `thumb_url` inchangé (vignette slide 0).

## 4. Frontend

- **`frontend/src/lib/types.ts`** :
  - `Video` gagne `media_type: 'video' | 'image'` et
    `media: { i: number; w: number; h: number }[] | null` (le `path` du jsonb
    est ignoré côté front — le service se fait par URLs signées, cf. §3).
  - `MediaUrls` gagne `media_type` et `slides?: string[]`.
- **`frontend/src/components/VideoCard.tsx`** : si `media_type==='image'` →
  pas de bouton play (`showPlay=false`) ; badge bas-droite « ⧉ {media.length} »
  à la place de la durée (option **A**).
- **`frontend/src/screens/GalleryScreen.tsx`** (nouveau) : reprend le décor du
  lecteur (barre du haut, fond flou ambiant dérivé de `thumb_color`, rangée
  d'actions renommer / catégorie / supprimer + feuilles correspondantes) mais
  remplace l'étage vidéo par une **piste swipe horizontale** (CSS scroll-snap
  natif), photos en **contain** sur fond flou, **pastilles** « ● ○ ○ » +
  **compteur** « 1/N ». Pas de scrub/play. Récupère les `slides` via `media-url`.
- **`frontend/src/App.tsx`** : à l'ouverture d'une carte, route vers
  `GalleryScreen` si `media_type==='image'`, sinon `PlayerScreen` (qui reste
  100 % vidéo — on ne le surcharge pas).

## 5. Statuts & gestion d'erreurs

Même machine à états : `analyzing → fetching → thumbnailing → ready` ; tout
échec → `error` (message ≤ 500 car., aucune exception ne s'échappe). Cas
particuliers → `error` explicite : aucune slide exploitable, échec
téléchargement d'une slide, gallery-dl + secours vidéo tous deux en échec.

## 6. Suppression (Spec 06) — slides 1..N

`DELETE /api/videos/{id}` purge aujourd'hui `storage_path` + `thumb_path`. Pour
un post image il faut aussi retirer les slides 1..N. Le purge itère donc sur
`storage_path`, `thumb_path` **et** chaque `media[i].path` (best-effort,
idempotent, confiné à `DATA_DIR` via `abs_path`). Le dossier
`<user_id>/<video_id>/` peut être retiré s'il devient vide.

## 7. Dépendances & Docker

- `gallery-dl` ajouté à `backend/requirements.txt` (pur pip, aucun paquet
  système). Lit le **même** `IG_COOKIES_FILE` (format Netscape, déjà
  bind-monté). Pas de seconde config cookies.
- Aucune dépendance front nouvelle. Pas de Pillow (ffmpeg suffit pour image →
  vignette + couleur dominante).
- `backend/Dockerfile` : `gallery-dl` arrive via `pip install -r requirements.txt`
  (vérifier qu'il est bien dans l'image, comme yt-dlp).

## 8. Tests

- **Backend** (mock des binaires externes, comme l'existant) :
  - classification image / vidéo / mixte à partir d'une sortie gallery-dl mockée ;
  - filtrage des slides vidéo dans un carrousel mixte ;
  - forme du `media` jsonb (ordre, `i`, `path`, `w`, `h`) ;
  - transitions de statut sur la branche image ;
  - secours : gallery-dl en échec → flux vidéo ; post 100 % vidéo → flux vidéo ;
  - route `slide/{i}` : token valide / invalide / `i` hors borne / fichier absent ;
  - suppression : purge des slides 1..N.
- **Frontend** (vitest + `tsc` 0 + build) :
  - badge compteur sur `VideoCard` (image vs vidéo) ;
  - logique `GalleryScreen` (index courant, bornes du swipe, pastilles) ;
  - résolution des `slides` depuis `media-url`.
- **Migration** : `supabase/test/schema_test.sql` étendu — défauts
  (`media_type='video'`, `media=null`), check `media_type`, lignes existantes
  inchangées.

## 9. Hors-périmètre (YAGNI)

Vidéo dans le swipe · table relationnelle `media_items` · normalisation /
recadrage / re-encodage des images · cadre adaptatif par slide. La porte reste
ouverte (le `media` jsonb pourra accueillir `kind:'video'` plus tard) sans le
construire maintenant.
