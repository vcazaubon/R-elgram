# Réelgram Spec 03 — PWA shell & design system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. UI porting : la vérité de code est `design-reference/project/` (porter PIXEL-PERFECT). Gates de vérif = `tsc --noEmit` strict + `npm run build`. Steps en `- [ ]`.

**Goal:** Frontend Vite+React+TS installable (PWA) reproduisant pixel-perfect le mockup, en données mock, avec routing state-based et transitions du proto. À la fin : l'app tourne en local et ressemble exactement au mockup, sans backend ni auth.

**Architecture:** `frontend/` Vite+React+TS. `styles.css` copié verbatim + app-shell PWA full-bleed. Composants et écrans portés JSX→TSX (rendu identique). Routing state-based (comme `pwa/pwa-app.jsx`). Config runtime via `window.__ENV__`. `frontend/src/lib/types.ts` existe DÉJÀ (Spec 01) — ne pas l'écraser ; les écrans mock peuvent utiliser un `mock.ts` séparé.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), vite-plugin-pwa, workbox-window.

---

## File Structure
- `frontend/package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`, `.gitignore`
- `frontend/public/env.js` (dev), `frontend/public/icons/*` (copiés de design-reference)
- `frontend/src/lib/config.ts` (lit window.__ENV__), `frontend/src/lib/mock.ts` (CATEGORIES/VIDEOS mock)
- `frontend/src/styles.css` (verbatim + app-shell PWA)
- `frontend/src/components/` : Icons, StatusBar, Thumb, PlaceholderLabel, VideoCard, TabBar
- `frontend/src/screens/` : LoginScreen, LibraryScreen, EmptyScreen, CategoriesScreen, ImportScreen, PlayerScreen, (DesignDirectionScreen optionnel)
- `frontend/src/App.tsx`, `frontend/src/main.tsx`

---

## Phase A — Scaffold + design system (config, styles, composants)

### Task A1: Scaffold Vite+React+TS + deps + config runtime
**Files:** Create `frontend/package.json`, `tsconfig.json`+`tsconfig.app.json`+`tsconfig.node.json`, `vite.config.ts`, `index.html`, `frontend/.gitignore`, `frontend/public/env.js`, `frontend/src/lib/config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx` (stub).
- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts` dans `frontend/` (préserver `src/lib/types.ts` existant). Ajouter deps `@supabase/supabase-js`, `vite-plugin-pwa`, `workbox-window`. tsconfig strict.
- [ ] **Step 2:** `vite.config.ts` : plugin react + VitePWA (registerType autoUpdate, manifest = celui de `design-reference/project/pwa/manifest.webmanifest` adapté `start_url:'/'`/`scope:'/'`, icônes), `server.proxy['/api'] → http://localhost:8000`, `workbox.navigateFallbackDenylist:[/^\/api\//]`.
- [ ] **Step 3:** `index.html` : meta iOS de `design-reference/project/pwa/index.html` (apple-mobile-web-app-capable, status-bar black-translucent, viewport-fit=cover, apple-touch-icon, theme-color #0a0a0c), `<script src="/env.js">` avant le bundle.
- [ ] **Step 4:** `public/env.js` (dev) : `window.__ENV__={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',API_URL:'/api',ALLOW_SIGNUPS:'true'}`. `src/lib/config.ts` lit `window.__ENV__` avec fallbacks + déclare `window.__REELGRAM_PWA=true`. Copier `design-reference/project/pwa/icons/*` → `public/icons/`.
- [ ] **Step 5: Gate** : `cd frontend && npm install && npx tsc --noEmit && npm run build` → 0 erreur, manifest+sw émis. **Commit** "Spec 03 A1: scaffold Vite+PWA + config runtime".

### Task A2: styles.css verbatim + app-shell + composants
**Files:** Create `frontend/src/styles.css`, `frontend/src/lib/mock.ts`, `frontend/src/components/{Icons,StatusBar,Thumb,PlaceholderLabel,VideoCard,TabBar}.tsx`
- [ ] **Step 1:** `src/styles.css` = copie VERBATIM de `design-reference/project/styles.css`, PUIS ajouter le bloc app-shell PWA (de `pwa/index.html` <style>) : `#stage{all:unset}`, `.app-root{position:relative;width:100%;max-width:520px;height:100dvh;margin:0 auto;background:var(--bg-0);overflow:hidden;background-image:radial-gradient(...)}`, `#root{width:100%;height:100%}`. (Les règles `.phone`/bezel du proto à rail sont inutiles ici — ne pas les recopier ; garder uniquement tokens + composants + transitions + app-shell.)
- [ ] **Step 2:** `src/lib/mock.ts` : `MockCategory`/`MockVideo` types + `CATEGORIES`/`VIDEOS`/`catById` portés verbatim de `design-reference/project/data.jsx`.
- [ ] **Step 3:** Porter les composants de `design-reference/project/{data.jsx (Icons),components.jsx}` en TSX typé, rendu IDENTIQUE : `Icons` (tous les glyphes), `StatusBar` (collapse safe-area si `window.__REELGRAM_PWA`), `Thumb`, `PlaceholderLabel`, `VideoCard` (sur MockVideo, dégradé `g`), `TabBar`.
- [ ] **Step 4: Gate** : `npx tsc --noEmit && npm run build` → 0 erreur. **Commit** "Spec 03 A2: styles verbatim + app-shell + composants".

---

## Phase B — Écrans + routing + PWA

### Task B1: écrans portés (mock)
**Files:** Create `frontend/src/screens/{LoginScreen,LibraryScreen,EmptyScreen,CategoriesScreen,ImportScreen,PlayerScreen}.tsx` (+ `DesignDirectionScreen.tsx` optionnel)
- [ ] **Step 1:** Porter chaque écran de `design-reference/project/screens-*.jsx` en TSX, données mock, rendu identique :
  - LoginScreen (welcome/email + Face ID/Apple glyphs + microcopy) — `onEnter` direct en mock.
  - LibraryScreen (recherche, chips catégories, FAB glowPulse, cards, count, bouton sparkle).
  - EmptyScreen (hero stacked cards + 3 étapes + CTA).
  - CategoriesScreen (CRUD inline add/rename/delete sur état local).
  - ImportScreen (form + preview + sélecteur catégorie + ProgressBlock 4 étapes simulée + état erreur via `forceError`).
  - PlayerScreen (stage 9:16, scrub simulé, action row, bottom sheets rename/category/delete/more).
- [ ] **Step 2: Gate** : `npx tsc --noEmit && npm run build` → 0 erreur. **Commit** "Spec 03 B1: écrans portés (mock)".

### Task B2: App routing + main + PWA register
**Files:** Modify `frontend/src/App.tsx`, `frontend/src/main.tsx`
- [ ] **Step 1:** `App.tsx` : routing state-based (route login|library|categories|import|player|direction, tab, current, navKey pour rejouer `view-enter`) + handlers mock (open/save/delete/rename/cat sur état local), comme `pwa/pwa-app.jsx`. `main.tsx` : createRoot + `registerSW` (vite-plugin-pwa), import `styles.css`.
- [ ] **Step 2: Gate final** : `npx tsc --noEmit && npm run build` → 0 erreur ; vérifier `dist/manifest.webmanifest`, `dist/sw.js` émis et que le SW ne précache pas `/api`. **Commit** "Spec 03 B2: app routing + PWA register".

---

## Self-Review
- **Spec coverage :** scaffold+PWA+config (A1) ✓ · styles verbatim+app-shell+composants (A2) ✓ · tous les écrans (B1) ✓ · routing state-based+SW (B2) ✓ · `types.ts` préservé ✓ · proxy dev `/api` ✓ · SW ne cache pas `/api` ✓.
- **Placeholders :** aucun — chaque tâche pointe les fichiers source exacts à porter + le gate de vérif. Le "code complet" est `design-reference/` (à reproduire verbatim/à l'identique).
- **Fidélité :** réutiliser classes/tokens de styles.css ; conserver valeurs px décimales/rayons/gaps/dégradés/easings des fichiers proto. Gate = tsc strict + build.
