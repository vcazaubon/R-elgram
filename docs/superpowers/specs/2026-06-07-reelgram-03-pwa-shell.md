# Spec 03 — PWA shell & design system

> Lis `2026-06-07-reelgram-design.md`. Dépend de Spec 01.
> Source de vérité visuelle : `design-reference/project/` — **pixel-perfect**.

## Objectif
Scaffolder le **frontend Vite + React + TypeScript** installable (PWA), porter le
**design system** (tokens + composants partagés) et les écrans en **données mock**,
avec le routing state-based et les transitions du prototype. À la fin de cette
spec, l'app tourne en local et **ressemble exactement** au mockup, sans backend ni auth.

## Tâches

### 1. Scaffold
- `npm create vite@latest frontend -- --template react-ts`.
- Dépendances : `@supabase/supabase-js` (utilisé en Spec 04/05),
  `vite-plugin-pwa`, `workbox-window`.
- `tsconfig` strict.

### 2. Config runtime (`env.js`) — voir `Design maître §6`
- `index.html` charge `<script src="/env.js"></script>` **avant** le bundle.
- `frontend/src/lib/config.ts` : lit `window.__ENV__` avec fallback dev
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_URL='/api'`, `ALLOW_SIGNUPS`).
- `frontend/public/env.js` (dev) : valeurs depuis `.env` local ; en prod, généré
  par `docker-entrypoint.sh` (Spec 07).
- **Proxy dev** : dans `vite.config.ts`, ajouter `server.proxy['/api'] →
  http://localhost:8000` pour que `API_URL='/api'` marche en `npm run dev` (le
  backend tourne en local sur :8000). En prod, c'est nginx qui proxifie (Spec 07).

### 3. Styles
- Copier `design-reference/project/styles.css` **verbatim** dans
  `frontend/src/styles.css`.
- Ajouter l'app-shell full-bleed PWA (cf. `design-reference/project/pwa/index.html`
  `<style>`) : `.app-root` (max-width 520px centré, `100dvh`, glow ambiant),
  `#stage{all:unset}`. **Supprimer** le `.phone`/bezel/`#stage padding-right`
  (réservés au proto à rail). On vise le full-bleed installable.
- `window.__REELGRAM_PWA = true` (le `StatusBar` collapse en safe-area, cf. proto).

### 4. Composants partagés → `frontend/src/components/`
Porter depuis `design-reference/project/`, en TSX typé, **rendu identique** :
- `Icons.tsx` (depuis `data.jsx` `Icons` + `Ico`).
- `StatusBar.tsx` (depuis `components.jsx`) — collapse en safe-area en mode PWA.
- `Thumb.tsx`, `PlaceholderLabel.tsx`, `VideoCard.tsx`, `TabBar.tsx`
  (depuis `components.jsx`). `VideoCard` accepte un `Video` (cf. types Spec 01) ;
  le dégradé `g` du proto est remplacé par : si `thumb_url` présent → `<img>`,
  sinon dégradé dérivé de `thumb_color`. **En Spec 03 (mock), garder le dégradé.**
- `buttons` : `.btn-primary`, `.btn-ghost`, `.pill` viennent du CSS (classes), pas
  de composant obligatoire.

### 5. Écrans (mock) → `frontend/src/screens/`
Porter en TSX, avec **données mock** (reprendre `VIDEOS`/`CATEGORIES` de `data.jsx`) :
- `LibraryScreen` (recherche, filtres chips, FAB, cards, count) — `screens-main.jsx`.
- `EmptyScreen` (hero + 3 étapes + CTA) — `screens-main.jsx`.
- `CategoriesScreen` (liste + add/rename/delete inline) — `screens-main.jsx`.
- `ImportScreen` (form + progression 4 étapes + erreur) — `screens-import.jsx`
  (en mock : la progression est simulée comme dans le proto ; branchée en Spec 06).
- `PlayerScreen` (lecteur 9:16, scrub, action row, bottom sheets) — `screens-player.jsx`
  (en mock : `<Thumb>` placeholder ; vrai `<video>` branché en Spec 05).
- `LoginScreen` — `screens-login.jsx` (en mock : `onEnter` direct ; branché en Spec 04).
- `DesignDirectionScreen` — `screens-direction.jsx` (**optionnel**, basse priorité).

### 6. App shell & routing → `frontend/src/App.tsx`
Reprendre la logique de `design-reference/project/pwa/pwa-app.jsx` :
- état `route` (`login|library|categories|import|player|direction`), `tab`,
  `current` (vidéo), `navKey` pour rejouer les transitions (`view-enter`).
- handlers mock : open/save/delete/rename/cat — sur l'état local pour l'instant.
- `main.tsx` : `createRoot` + register service worker (via vite-plugin-pwa).

### 7. PWA (vite-plugin-pwa) → `vite.config.ts`
- `registerType: 'autoUpdate'`, manifest = `design-reference/project/pwa/manifest.webmanifest`
  (name, short_name, description, theme/background `#0a0a0c`, display standalone,
  orientation portrait, icônes).
- Copier les icônes de `design-reference/project/pwa/icons/` vers `frontend/public/icons/`.
- `index.html` : meta iOS de `design-reference/project/pwa/index.html`
  (`apple-mobile-web-app-capable`, `status-bar-style black-translucent`,
  `viewport-fit=cover`, `apple-touch-icon`, `theme-color`).
- Service worker : precache du shell (vite-plugin-pwa génère Workbox). Runtime
  caching de l'API ajouté/affiné en Spec 06/07 si utile (au minimum, ne pas
  cacher `/api`).

## Critères d'acceptation
- `npm run dev` : l'app s'affiche, full-bleed, **pixel-perfect** vs mockup
  (couleurs, rayons, espacements, dégradé d'accent, glassmorphism, FAB glow,
  transitions entre écrans).
- Navigation mock complète : login→library→player→back, tab library/categories,
  FAB→import (progression simulée), recherche/filtres fonctionnent sur le mock.
- `npm run build` produit un bundle ; le manifest + SW sont émis ; l'app est
  installable (Lighthouse PWA installable = OK en preview HTTPS/localhost).
- Aucune dépendance au backend/Supabase à ce stade (tout mock).

## Garde-fous pixel-perfect
- Ne pas réinventer le CSS : réutiliser les classes/tokens de `styles.css`.
- Conserver les valeurs exactes (tailles de police en px décimaux, rayons, gaps)
  telles qu'écrites dans les fichiers proto.
