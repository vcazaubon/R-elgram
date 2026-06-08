# Spec — Affichage robuste de la bibliothèque (lazy thumbnails + windowing natif)

> Chantier de scalabilité de l'affichage, post-V1. Touche **uniquement le
> frontend** (`frontend/src/`). Dépend de Spec 05 (lecteur/bibliothèque, déjà en
> place). Aucun changement backend ni migration Supabase. Rendu **pixel-perfect**
> conservé (décision verrouillée du design maître §1).
> cf. `docs/superpowers/specs/2026-06-07-reelgram-design.md`

## Objectif

Aujourd'hui, la bibliothèque ne tient pas le passage à l'échelle (« plusieurs
centaines de vidéos ») sur trois points cumulés :

1. **Fetch non borné** — `db.listVideos()` (`frontend/src/lib/db.ts:29`) fait
   `select('*').order('created_at')` **sans `.limit()`** : Supabase plafonne
   silencieusement à 1000 lignes.
2. **Aucun windowing au rendu** — `LibraryScreen` (`LibraryScreen.tsx:109`) monte
   **toutes** les cartes dans le DOM, chacune avec `backdrop-filter` blur,
   dégradés et SVG → jank sur mobile.
3. **Toutes les vignettes téléchargées au lancement** *(le vrai problème)* —
   `App.tsx:242-262` lance un **unique `Promise.all`** appelant `getMediaUrl(v.id)`
   pour **chaque** vidéo `ready`, puis monte autant de `<img>` **sans
   `loading="lazy"`** (`Thumb.tsx:68`). Les vignettes sont donc effectivement
   **toutes téléchargées d'emblée**.

On veut : au lancement et au défilement, ne charger (réseau) et ne peindre que
**ce qui est proche de l'écran**.

### Hors objectif — déjà robuste (audit, ne pas toucher)

- **Préchargement vidéo** : l'élément `<video>` n'existe que dans `PlayerScreen`
  (monté seulement quand `route === 'player'`, `App.tsx:378`). **Une seule vidéo
  streame** — celle ouverte. Streaming via **HTTP Range** (206, `media.py:111-163`).
  Rien à changer.
- **Suppression** : `DELETE /api/videos/{id}` (`main.py:167-190`) purge fichier +
  vignette sur disque (`unlink`, idempotent) puis la ligne DB ; couvert par
  `test_delete_purges_row_file_thumb`. Rien à changer.

### Décisions verrouillées (brainstorming)

- **Volume cible** : ≤ ~1000 vidéos. Métadonnées **entièrement en mémoire** (1
  requête légère). Pas de pagination serveur.
- **Approche** : **A — lazy + natif, zéro dépendance** (vs B virtualisation par
  lib, vs C pagination « charger plus »). Aucune nouvelle dépendance npm.
- **Vignettes** : chargées **à la demande** quand la carte approche du viewport ;
  hors écran → dégradé `thumb_color` (déjà le visuel prévu par le design).
- **Windowing** : natif via CSS `content-visibility: auto` (aucune carte
  démontée → animation « rise », scroll et pixel-perfect intacts).
- **Recherche / filtre** : restent **client-side** sur le tableau complet en
  mémoire (inchangés).

### Hors périmètre (YAGNI)

- Pagination serveur / infinite scroll (réservé si on dépasse ~1000).
- Lib de virtualisation (`react-window`, `@tanstack/react-virtual`).
- Re-signature proactive des vignettes dont l'URL signée a expiré (>1 h) — la
  dégradation vers le dégradé via `Thumb.onError` est suffisante.

## Architecture

Découpage en unités à responsabilité unique, dont la logique testable est
extraite en module `.ts` pur (l'environnement vitest est `node` — pas de
jsdom/testing-library ; cf. `vitest.config.ts`).

### 1. `frontend/src/lib/thumbnails.ts` *(nouveau — logique pure, testable)*

Gestionnaire de chargement de vignettes, sans dépendance React/DOM.

```ts
export interface ThumbnailLoader {
  /** Demande la vignette de `id`. No-op si déjà résolue ou déjà en vol. */
  request(id: string): void;
  /** True si `id` a déjà une URL résolue (en cache). */
  has(id: string): boolean;
}

export interface ThumbnailLoaderOptions {
  /** Résout l'URL de vignette d'une vidéo (= api.getMediaUrl → thumb_url). */
  fetch: (id: string) => Promise<string>;
  /** Appelé une fois l'URL résolue, pour la pousser dans l'état React. */
  onResolved: (id: string, url: string) => void;
}

export function createThumbnailLoader(opts: ThumbnailLoaderOptions): ThumbnailLoader;
```

Comportement :
- `request(id)` : si `id` en cache **ou** déjà en vol → **no-op** (dédoublonnage).
  Sinon marque « en vol », appelle `fetch(id)`.
  - succès → met en cache + `onResolved(id, url)` + retire de « en vol ».
  - échec → **ne cache pas**, retire de « en vol » (un futur `request(id)`
    pourra retenter quand la carte redevient visible).
- État interne : `Map<string,string>` (résolus) + `Set<string>` (en vol).

> Note d'intégration : `fetch` est `(id) => getMediaUrl(id).then(m => m.thumb_url)`,
> wiré dans `App.tsx`. Le loader ignore `stream_url` (résolu à l'ouverture du
> lecteur, flux inchangé).

### 2. `frontend/src/lib/useInView.ts` *(nouveau — hook minimal)*

```ts
export function useInView(
  ref: React.RefObject<Element>,
  options?: { rootMargin?: string },
): boolean;
```

- `IntersectionObserver` sur `ref.current`. Renvoie `true` **dès la première
  intersection** et **reste `true`** (sticky : une fois la vignette demandée, pas
  besoin de la « décharger »). Déconnecte l'observer après le premier passage à
  `true`.
- `rootMargin` par défaut `'200px 0px'` (préchargement léger avant entrée écran).
- Repli : si `IntersectionObserver` est indisponible (très vieux navigateur),
  renvoyer `true` immédiatement (dégrade vers le comportement « charge tout »,
  jamais d'écran vide). Non couvert par vitest (DOM) — vérif manuelle.

### 3. `frontend/src/components/VideoCard.tsx` *(modifié)*

- Ajout d'un `ref` sur le wrapper externe (`.rise`, le `<button>` / `<div>`).
- `const inView = useInView(cardRef, { rootMargin: '200px 0px' })`.
- Effet : `if (inView && ready) onThumbVisible(video.id)`.
- Nouvelle prop optionnelle `onThumbVisible?: (id: string) => void`.
- Affichage `thumbUrl` (prop) si présent, sinon dégradé — **inchangé**.
- Sur le wrapper externe : `style={{ contentVisibility: 'auto',
  containIntrinsicSize: 'auto 320px', ... }}` → windowing natif (le navigateur
  saute layout/paint des cartes hors écran ; `auto` mémorise la taille réelle
  une fois peinte → scrollbar stable).
- **Stagger** : plafonner `animationDelay` à `Math.min(index, 12) * 0.04 + 's'`
  (sinon délais absurdes type 20 s pour `index = 500`).
- **Pixel-perfect** : aucune structure/style visible modifié ; `content-visibility`
  et `useInView` n'affectent que le hors-écran / le réseau.

### 4. `frontend/src/screens/LibraryScreen.tsx` *(modifié)*

- Nouvelle prop `onThumbVisible: (id: string) => void`, transmise à chaque
  `<VideoCard>`. Tout le reste (recherche, filtre, count, FAB) **inchangé**.

### 5. `frontend/src/App.tsx` *(modifié)*

- **Supprimer** l'effet `Promise.all` global (lignes 242-262 actuelles).
- Instancier le loader une fois (via `useRef`/`useMemo`) :
  ```ts
  const thumbLoader = useThumbLoader(); // crée createThumbnailLoader({
  //   fetch: (id) => getMediaUrl(id).then(m => m.thumb_url),
  //   onResolved: (id, url) => setThumbUrls(p => ({ ...p, [id]: url })),
  // })
  ```
- `const onThumbVisible = (id) => thumbLoader.request(id)` (passé à `LibraryScreen`).
- `thumbUrls` (state) **conservé** + cache loader → un refetch
  (realtime / foreground / poll de secours) **ne re-télécharge pas** les vignettes
  déjà connues (dédoublonnage par le loader + garde `has`).

### 6. `frontend/src/lib/db.ts` *(modifié)*

- `listVideos()` : ajout d'un `.limit(MAX_LIBRARY)` explicite avec
  `const MAX_LIBRARY = 1000` (borne documentée remplaçant la troncature
  silencieuse de Supabase). Ordre « newest first » conservé.

## Flux de chargement (après)

1. App fetch métadonnées (1 requête, ≤1000) → `videos`.
2. `LibraryScreen` rend **toutes** les cartes ; `content-visibility: auto` ne
   peint que celles à l'écran.
3. Carte visible (ou à <200 px) : `useInView` → `onThumbVisible(id)` →
   `thumbLoader.request(id)` → `getMediaUrl(id)` → `setThumbUrls` → la carte
   affiche `<img>`. Hors écran → dégradé `thumb_color`.
4. Scroll → nouvelles cartes entrent → leurs vignettes se chargent à la demande.
5. Ouverture d'une vidéo → `PlayerScreen` streame (Range) la seule vidéo
   concernée — **inchangé**.

## Cas limites / erreurs

- **URL signée expirée (>1 h)** : `<img src>` échoue → `Thumb.onError` →
  `imgFailed` → dégradé (déjà en place, `Thumb.tsx:50,71`). Pas de re-signature
  proactive (hors périmètre).
- **Échec `getMediaUrl`** : loader ne cache pas → retry possible si la carte
  redevient visible ; entre-temps dégradé.
- **Recherche / filtre** : inchangés (tableau complet en mémoire) ; cache vignette
  réutilisé si une carte réapparaît après changement de filtre.
- **Refetch realtime / foreground / poll** : cache loader + `thumbUrls`
  persistent → aucun re-téléchargement en masse.
- **Vidéos non-`ready`** : pas de vignette demandée (`onThumbVisible` gardé par
  `ready`) — la carte affiche déjà l'overlay de progression.

## Tests

- **`frontend/src/lib/thumbnails.test.ts`** (TDD, env node) :
  - `request(id)` deux fois → `fetch` appelé **une** seule fois (dédoublonnage en vol).
  - succès → `onResolved(id, url)` appelé avec l'URL ; `has(id) === true` ensuite ;
    un nouveau `request(id)` ne refait **pas** de `fetch`.
  - échec de `fetch` → `onResolved` non appelé, `has(id) === false`, un `request`
    ultérieur **retente** le `fetch`.
- **DOM / IntersectionObserver / `content-visibility` / lazy-au-scroll** : non
  couverts par vitest (env node) → **vérification manuelle sur le dev server
  (port 10009)** : avec quelques centaines de vidéos, vérifier dans l'onglet
  réseau que **seules les vignettes du premier écran** partent au load, puis que
  les suivantes se chargent au défilement ; vérifier que le rendu reste identique
  au design.
- **Suite existante** : doit rester verte (`npm test` côté frontend, `pytest`
  côté backend inchangé). Vérifier qu'aucun test existant ne dépendait de l'effet
  `Promise.all` supprimé (a priori aucun).

## Critères d'acceptation

1. Au chargement d'une bibliothèque de plusieurs centaines de vidéos, seules les
   vignettes des cartes visibles (+ marge 200 px) sont requêtées/téléchargées ;
   les autres se chargent au défilement.
2. Aucune vidéo n'est préchargée (comportement déjà acquis — non régressé).
3. Le rendu visuel est **identique** au design (cartes, espacement, animation
   d'entrée, scroll).
4. `listVideos()` est borné à 1000 lignes explicitement.
5. La suppression purge toujours fichier + vignette + ligne (non régressé).
6. `thumbnails.test.ts` passe ; suite existante verte ; **zéro nouvelle
   dépendance** dans `frontend/package.json`.
