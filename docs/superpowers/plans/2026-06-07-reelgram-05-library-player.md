# Réelgram Spec 05 — Bibliothèque / Catégories / Lecteur + Compte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD vitest sur `api.ts` (mock fetch) ; gate global tsc strict + build. Steps en `- [ ]`.

**Goal:** Brancher Library/Empty/Categories/Player sur les données réelles (Supabase RLS pour les métadonnées, backend pour la lecture vidéo via URLs signées), migrer les écrans de `mock.ts` vers les types réels, et ajouter la feuille « Compte / Raccourci iOS » (email, tokens, déconnexion).

**Architecture:** `api.ts` (client backend, attache le JWT) + `db.ts` (couche Supabase typée, RLS via session). Les écrans consomment `Video`/`Category` de `types.ts`. Vraie miniature via URL signée (`media-url`), fallback dégradé dérivé de `thumb_color`. Lecture vidéo `<video src=stream_url>`. Suppression via `api.deleteVideo` (endpoint backend ajouté en Spec 06).

**Tech Stack:** @supabase/supabase-js, fetch, vitest.

---

## File Structure
- `frontend/src/lib/api.ts` — client backend (`apiFetch`, `getMediaUrl`, `ingest`, `ingestStatus`, `deleteVideo`, `listTokens`, `createToken`, `deleteToken`).
- `frontend/src/lib/db.ts` — Supabase data layer (videos/categories CRUD + realtime).
- `frontend/src/lib/color.ts` — `gradientFromColor(hex)` (fallback dégradé).
- `frontend/src/lib/api.test.ts` — vitest (mock fetch).
- Modify screens: `LibraryScreen.tsx`, `EmptyScreen.tsx`, `CategoriesScreen.tsx`, `PlayerScreen.tsx`, `VideoCard.tsx`, `Thumb.tsx`.
- Create `frontend/src/screens/AccountSheet.tsx`.
- Modify `frontend/src/App.tsx` (real handlers + Account sheet + remove hidden logout).

---

## Task 1: api.ts client (TDD vitest)
**Files:** Create `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`
- [ ] **Step 1: test (rouge)** — mock `global.fetch` ; mock `getAccessToken` (via injection ou module mock) :
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// api.ts doit accepter un getter de token injectable (setAuthTokenGetter) pour testabilité
import * as api from './api';
beforeEach(()=>{ api.setAuthTokenGetter(async()=> 'JWT123'); (global as any).fetch = vi.fn(); });
it('ingest POSTs with Bearer + body', async () => {
  (fetch as any).mockResolvedValue({ ok:true, status:200, json:async()=>({id:'v1',status:'analyzing'}) });
  const r = await api.ingest('https://instagram.com/reel/x','cat1');
  const [url, opts] = (fetch as any).mock.calls[0];
  expect(url).toContain('/api/ingest');
  expect(opts.method).toBe('POST');
  expect(opts.headers.Authorization).toBe('Bearer JWT123');
  expect(JSON.parse(opts.body)).toEqual({url:'https://instagram.com/reel/x', category_id:'cat1'});
  expect(r.id).toBe('v1');
});
it('getMediaUrl GETs media-url', async () => {
  (fetch as any).mockResolvedValue({ ok:true,status:200, json:async()=>({stream_url:'/s?t=1',thumb_url:'/t?t=1'}) });
  const r = await api.getMediaUrl('v1');
  expect((fetch as any).mock.calls[0][0]).toContain('/api/videos/v1/media-url');
  expect(r.stream_url).toBe('/s?t=1');
});
it('throws on non-ok', async () => {
  (fetch as any).mockResolvedValue({ ok:false,status:400, json:async()=>({detail:'bad'}) });
  await expect(api.ingest('x')).rejects.toBeTruthy();
});
```
- [ ] **Step 2: run rouge** `npx vitest run src/lib/api.test.ts` → FAIL.
- [ ] **Step 3: api.ts** — `setAuthTokenGetter(fn)` (défaut branché sur `auth` plus tard via App) ; `apiFetch(path, opts)` préfixe `config.apiUrl`, attache `Authorization: Bearer <token>` si dispo, parse JSON, throw sur `!ok` (avec `detail`). Méthodes : `ingest(url, categoryId?)`, `ingestStatus(id)`, `getMediaUrl(id)`, `deleteVideo(id)` (DELETE — endpoint backend en Spec 06), `listTokens()`, `createToken(label?)`, `deleteToken(id)`.
- [ ] **Step 4: run vert** + **Commit** "Spec 05 T1: api client (vitest)".

## Task 2: db.ts (Supabase) + color helper
**Files:** Create `frontend/src/lib/db.ts`, `frontend/src/lib/color.ts`
- [ ] **Step 1:** `color.ts` : `gradientFromColor(hex)` → `[c1,c2]` (assombrir/varier le hex pour un dégradé plausible). Petit test vitest (`gradientFromColor('#a78bfa')` renvoie 2 hex valides).
- [ ] **Step 2:** `db.ts` (utilise `supabase` de Spec 04) : `listVideos():Promise<Video[]>` (order created_at desc), `listCategories():Promise<Category[]>` (order position), `updateVideo(id,{title?|category_id?})`, `createCategory(label)`, `renameCategory(id,label)`, `deleteCategory(id)`, `subscribeVideos(cb)` (realtime sur table videos, renvoie unsubscribe). `deleteVideo(id)` = `api.deleteVideo(id)` (PAS de delete Supabase direct — purge complète en Spec 06).
- [ ] **Step 3: Gate** `npx vitest run && npx tsc --noEmit && npm run build`. **Commit** "Spec 05 T2: db Supabase + color helper".

## Task 3: Library + Empty + VideoCard/Thumb (données réelles)
**Files:** Modify `LibraryScreen.tsx`, `EmptyScreen.tsx`, `VideoCard.tsx`, `Thumb.tsx`
- [ ] **Step 1:** `Thumb`/`VideoCard` acceptent un `Video` réel : si une `thumbUrl` est fournie → `<img>`, sinon dégradé via `gradientFromColor(thumb_color)`. `VideoCard` affiche title/author/date (formatée depuis `created_at`)/duration (depuis `duration_seconds`)/catégorie. Vidéos `status!=='ready'` : badge « … », non cliquables.
- [ ] **Step 2:** `LibraryScreen` charge `listVideos()`+`listCategories()` (state + loading), recherche locale, chips = catégories réelles, FAB → import. Récupère les `thumb_url` via `getMediaUrl` (batch/à la demande). Liste vide → `EmptyScreen`. Bouton header **Compte** (remplace sparkle) → ouvre AccountSheet (T6).
- [ ] **Step 3: Gate** tsc+build. **Commit** "Spec 05 T3: Library/Empty données réelles".

## Task 4: Categories (CRUD réel)
**Files:** Modify `CategoriesScreen.tsx`
- [ ] **Step 1:** add/rename/delete via `db.ts` ; `count(id)` = vidéos réelles ; suppression → vidéos `category_id=null` (affichage « Sans catégorie »). UX inline identique au proto.
- [ ] **Step 2: Gate** tsc+build. **Commit** "Spec 05 T4: Categories CRUD réel".

## Task 5: Player (vraie vidéo)
**Files:** Modify `PlayerScreen.tsx`
- [ ] **Step 1:** `<video src=getMediaUrl(id).stream_url playsInline>` ; contrôles custom (play/pause, scrub lié `currentTime`/`duration`) ; backdrop ambient via `thumb_color` ; bottom sheets : rename→`updateVideo(title)`, category→`updateVideo(category_id)`, delete→`deleteVideo` + retour library. Garder le rendu cinématique.
- [ ] **Step 2: Gate** tsc+build. **Commit** "Spec 05 T5: Player vraie vidéo".

## Task 6: AccountSheet + App wiring réel
**Files:** Create `frontend/src/screens/AccountSheet.tsx`; Modify `frontend/src/App.tsx`
- [ ] **Step 1:** `AccountSheet` (style PlayerSheet) : email (`useAuth().user`), section Raccourci iOS (`createToken`→affiche le plaintext une fois + copier ; `listTokens`+`deleteToken`), bouton Déconnexion (`signOut`), toggle « Activer Face ID » (enroll/clear via biometric). 
- [ ] **Step 2:** `App.tsx` : remplacer les handlers mock par les appels réels (open via getMediaUrl, save via import flow Spec 07, update/delete/rename/cat via db/api), brancher `setAuthTokenGetter(getAccessToken)`, ouvrir AccountSheet depuis le bouton Compte, supprimer le bouton logout caché.
- [ ] **Step 3: Gate final** `npx vitest run && npx tsc --noEmit && npm run build` → tout vert. **Commit** "Spec 05 T6: AccountSheet + wiring App réel".

---

## Self-Review
- **Spec coverage :** api client (T1) ✓ · db Supabase + realtime (T2) ✓ · Library/Empty vraies données+miniatures (T3) ✓ · Categories CRUD (T4) ✓ · Player vraie vidéo+sheets (T5) ✓ · AccountSheet email/token/logout/FaceID (T6) ✓ · migration mock→types réels ✓ · deleteVideo via backend (Spec 06) ✓.
- **Placeholders :** test api fourni ; wiring décrit précisément par écran. Pas de TODO. (Note : `deleteVideo` nécessite l'endpoint backend de Spec 06 ; l'appel est en place dès maintenant.)
- **Type consistency :** `Video`/`Category` de `types.ts` partout ; `getMediaUrl→MediaUrls` ; `setAuthTokenGetter` cohérent T1↔T6.
