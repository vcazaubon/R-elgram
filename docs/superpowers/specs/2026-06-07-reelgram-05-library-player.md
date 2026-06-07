# Spec 05 — Bibliothèque / Catégories / Lecteur (données réelles)

> Lis `2026-06-07-reelgram-design.md`. Dépend de Spec 02, 03, 04.
> Écrans : `screens-main.jsx` (Library/Empty/Categories), `screens-player.jsx`.

## Objectif
Brancher les écrans Bibliothèque, Catégories et Lecteur sur les **données réelles** :
CRUD métadonnées via **Supabase JS (RLS)**, lecture de la vidéo via le **backend**
(URLs signées). Ajouter la **feuille « Compte »** (email, génération de token iOS,
déconnexion) — la seule UI en plus du mockup.

## État actuel du frontend (après Spec 03 — réconciliation)
Les écrans (`LibraryScreen`, `EmptyScreen`, `CategoriesScreen`, `PlayerScreen`,
`ImportScreen`) et `VideoCard` sont typés sur `MockVideo`/`MockCategory` de
`frontend/src/lib/mock.ts` (champs proto `cat`/`g`/`date`/`dur`/`auteur`). **Migre-les
vers les types réels** `Video`/`Category` de `src/lib/types.ts` (`category_id`,
`thumb_color`, `author`, `duration_seconds`, `created_at`, `status`). `Thumb.tsx`
accepte un objet `{ g:[string,string] }` (dégradé) ; pour la vraie miniature, soit
afficher un `<img src=thumb_url>`, soit dériver `g` depuis `thumb_color`. Les handlers
mock de `App.tsx` (open/save/update/delete/rename/cat) sont à remplacer par les
appels Supabase/API réels.
Auth dispo (Spec 04) : `useAuth()` de `src/lib/auth.tsx` expose
`session/user/signIn/signUp/signOut/getAccessToken` ; un **bouton logout caché**
(placeholder 1×1px dans `App.tsx`) est à **remplacer** par la déconnexion de la
feuille Compte. Le client Supabase est `src/lib/supabase.ts` (RLS via session).

## Tâches

### 1. API client → `frontend/src/lib/api.ts`
- `apiFetch(path, opts)` : préfixe `config.API_URL`, attache
  `Authorization: Bearer <getAccessToken()>`.
- Méthodes : `getMediaUrl(videoId) → {stream_url, thumb_url}`,
  `ingest(url, categoryId)`, `ingestStatus(id)`, `listTokens()`, `createToken(label)`,
  `deleteToken(id)`. (ingest/status utilisés en Spec 07.)

### 2. Data layer Supabase → `frontend/src/lib/db.ts`
Fonctions typées (RLS implicite via session) :
- `listVideos(): Video[]` — `select * from videos order by created_at desc`.
- `listCategories(): Category[]` — `order by position`.
- `updateVideo(id, {title?|category_id?})`.
- `deleteVideo(id)` — **délégué à la Spec 06** : passe par l'endpoint backend
  `DELETE /api/videos/{id}` qui purge la row **+ le fichier + la miniature**.
  Ne **pas** faire de delete Supabase direct ici.
- `createCategory(label)`, `renameCategory(id, label)`, `deleteCategory(id)`.
- **Temps réel** : s'abonner aux changements de `videos` (supabase realtime) pour
  refléter les nouvelles vidéos ingérées et les transitions de `status`. À défaut,
  refetch au focus + après actions.

### 3. LibraryScreen
- Charger `listVideos()` + `listCategories()`. Filtres chips = catégories réelles.
- Recherche locale (titre/auteur) comme le proto.
- `VideoCard` : afficher la **vraie miniature** via `getMediaUrl().thumb_url`
  (sinon dégradé dérivé de `thumb_color`). Les vidéos `status != 'ready'` :
  afficher un état « en cours » discret (skeleton/shimmer) ou les masquer de la
  liste principale (au choix — recommandé : badge « … » + non cliquable tant que
  pas `ready`).
- Si `listVideos()` vide → afficher `EmptyScreen`.
- FAB « Ajouter un lien » → route `import` (Spec 07).
- Le bouton header `sparkle` (Design Direction) est **remplacé** par un bouton
  **Compte** (avatar/cercle) ouvrant la feuille Compte (§6). (Garder Design
  Direction accessible seulement si on l'a porté, sinon le retirer.)

### 4. CategoriesScreen
- CRUD branché sur `db.ts` : add/rename/delete inline (même UX que le proto).
- `count(id)` = nombre de vidéos réelles de la catégorie.
- Supprimer une catégorie : les vidéos liées passent `category_id = null`
  (FK `on delete set null`, déjà en Spec 01). Gérer l'affichage « sans catégorie ».

### 5. PlayerScreen
- Remplacer le `<Thumb>` placeholder par un vrai `<video>` :
  `src = getMediaUrl(video.id).stream_url`, `playsInline`, contrôles custom du
  proto (play/pause, scrub bar liée à `currentTime/duration`). Garder le rendu
  cinématique (ambient backdrop dérivé de `thumb_color`, coins arrondis, glow).
- Scrub bar : binder sur le vrai `currentTime`/`duration` (remplacer la simulation).
- Bottom sheets : Renommer → `updateVideo(title)` ; Changer catégorie →
  `updateVideo(category_id)` ; Supprimer → `deleteVideo` + retour bibliothèque.
- `back` → bibliothèque.

### 6. Feuille « Compte / Raccourci iOS » → `frontend/src/screens/AccountSheet.tsx`
Bottom sheet (même style que `PlayerSheet`) ouvert depuis le bouton Compte :
- Affiche l'email du user.
- Section **Raccourci iOS** : bouton « Générer un token » → `createToken()` →
  affiche le token **une seule fois** (copier) + lien/texte vers le guide de setup
  (le guide détaillé est livré en Spec 07). Liste des tokens existants avec
  révocation. *(La génération in-app du token vit ici ; la recette du Raccourci est
  en Spec 07.)*
- Bouton **Déconnexion** (`signOut`).
- Optionnel : toggle « Activer Face ID » (enrôlement WebAuthn, cf. Spec 04 §4).

## Critères d'acceptation
- La bibliothèque affiche les vraies vidéos du compte connecté (RLS), avec vraies
  miniatures, recherche et filtres par catégories réelles.
- Le lecteur lit réellement le fichier vidéo (streaming range via backend),
  scrub fonctionnel, renommer/recatégoriser/supprimer persistés en base.
- CRUD catégories persisté ; compteurs corrects ; suppression met les vidéos à
  `category_id = null` sans casser l'affichage.
- La feuille Compte permet : voir l'email, générer/copier/révoquer un token iOS,
  se déconnecter.
- Aucune fuite inter-comptes (vérifier avec 2 comptes).
- Rendu pixel-perfect conservé.
