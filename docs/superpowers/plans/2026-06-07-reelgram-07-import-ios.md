# Réelgram Spec 07 — Flux Import + Raccourci iOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD vitest sur la logique de progression ; gate tsc strict + build. Steps en `- [ ]`.

**Goal:** Brancher l'écran Import sur l'ingestion réelle (yt-dlp via `api.ingest` + polling `api.ingestStatus`), avec la progression 4 étapes et l'état erreur/retry du design ; gérer un deep link `?import=<url>` ; livrer la recette du Raccourci iOS (`docs/ios-shortcut.md`) reliée depuis l'AccountSheet.

**Architecture:** ImportScreen pilote `api.ingest`→`{id}` puis poll `api.ingestStatus(id)` (~800ms) jusqu'à `ready`/`error`. Mapping `status→step→%` extrait en helper pur testé. App gère `?import=` au boot (ouvre Import prérempli) + `handleSaved` (refresh library). Manifest : `share_target` best-effort (Android). AccountSheet renvoie vers le guide iOS.

**Tech Stack:** React/TS, fetch (api.ts), vitest.

---

## File Structure
- `frontend/src/lib/ingestProgress.ts` — helper pur `progressFor(status, step)` → `{percent, phase, labels}`.
- `frontend/src/lib/ingestProgress.test.ts` — vitest.
- Modify `frontend/src/screens/ImportScreen.tsx` — branchement réel (form/progress/done/error).
- Modify `frontend/src/App.tsx` — `?import=` deep link + `handleSaved` refresh + passer `categories`.
- Modify `frontend/vite.config.ts` — manifest `share_target` (best-effort).
- Modify `frontend/src/screens/AccountSheet.tsx` — lien vers guide iOS + URL `/api/ingest`.
- Create `docs/ios-shortcut.md` — recette Raccourci iOS.

---

## Task 1: helper progression (TDD) + ImportScreen réel
**Files:** Create `frontend/src/lib/ingestProgress.ts`, `frontend/src/lib/ingestProgress.test.ts`; Modify `frontend/src/screens/ImportScreen.tsx`
- [ ] **Step 1: test (rouge)** `ingestProgress.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { progressFor } from './ingestProgress';
it('maps statuses to step/percent', () => {
  expect(progressFor('analyzing').step).toBe(0);
  expect(progressFor('fetching').step).toBe(1);
  expect(progressFor('thumbnailing').step).toBe(2);
  expect(progressFor('ready').step).toBe(3);
  expect(progressFor('ready').percent).toBe(100);
  expect(progressFor('analyzing').percent).toBeLessThan(100);
  expect(progressFor('analyzing').percent).toBeGreaterThanOrEqual(0);
});
it('error has isError', () => { expect(progressFor('error').isError).toBe(true); });
```
- [ ] **Step 2: run rouge** `npx vitest run src/lib/ingestProgress.test.ts` → FAIL.
- [ ] **Step 3:** `ingestProgress.ts` : `progressFor(status, step?)` → `{step, percent, isError, isDone}` (analyzing 0/~12%, fetching 1/~45%, thumbnailing 2/~78%, ready 3/100%, error step -1/isError). Réutilise `STATUS_STEP` de types.ts.
- [ ] **Step 4: ImportScreen** — supprimer la simulation setTimeout ; phases :
  - `form` : champ URL (préremplissable via prop `initialUrl`), sélecteur catégorie (réelles), bouton « Sauvegarder la vidéo ».
  - submit → `api.ingest(url, categoryId)` → `{id}` → phase `progress`.
  - `progress` : poll `api.ingestStatus(id)` toutes ~800ms ; `progressFor` anime le médaillon (%) + liste d'étapes ; cleanup de l'intervalle au unmount.
  - `status==='ready'` → phase `done` (✓ + « Voir dans la bibliothèque » → `onSaved`).
  - `status==='error'` → écran erreur du design (message court depuis `error`) + « Réessayer » (retour form) / « Annuler » (onClose).
  Garde le visuel/anim du proto.
- [ ] **Step 5: run vert** vitest + **Gate** tsc + build. **Commit** "Spec 07 T1: ImportScreen ingestion réelle + helper progression".

## Task 2: App deep link + handleSaved + manifest share_target
**Files:** Modify `frontend/src/App.tsx`, `frontend/vite.config.ts`
- [ ] **Step 1: App** — au boot (session active) : lire `?import=` (ou `?url=`) ; si présent → ouvrir ImportScreen avec `initialUrl` ; nettoyer le query param (history.replaceState). `handleSaved(catId?)` → fermer import, `go('library')`, `refresh()` (la nouvelle vidéo apparaît, status évolue via realtime/poll). Passer `categories` à ImportScreen.
- [ ] **Step 2: vite.config** — manifest : ajouter `share_target: { action: '/', method: 'GET', params: { url: 'import', text: 'import', title: 'title' } }` (best-effort Android ; iOS passe par le Raccourci). 
- [ ] **Step 3: Gate** tsc + build (manifest émis avec share_target). **Commit** "Spec 07 T2: deep link import + handleSaved + share_target".

## Task 3: Guide Raccourci iOS + lien AccountSheet
**Files:** Create `docs/ios-shortcut.md`; Modify `frontend/src/screens/AccountSheet.tsx`
- [ ] **Step 1:** `docs/ios-shortcut.md` — guide pas-à-pas FR : générer un token (AccountSheet) ; Raccourcis iOS → activer feuille de partage (entrée URL/Texte) ; action « Obtenir le contenu d'une URL » : `POST https://<domaine>/api/ingest`, en-têtes `X-Reelgram-Token: <token>` + `Content-Type: application/json`, body `{ "url": <Entrée>, "category_id"?: "<uuid>" }` ; réponse `{id,status}` ; erreurs (401 token invalide, 400 URL non-instagram, status=error cookies manquants) ; usage (Instagram→Partager→Réelgram).
- [ ] **Step 2: AccountSheet** — sous la section token, ajouter un court mémo « Raccourci iOS » : afficher l'URL exacte `${origin}/api/ingest` (copiable) + renvoi vers `docs/ios-shortcut.md` (texte/étapes inline succinctes). (La génération/liste/révocation de tokens existe déjà.)
- [ ] **Step 3: Gate** tsc + build. **Commit** "Spec 07 T3: guide Raccourci iOS + lien AccountSheet".

---

## Self-Review
- **Spec coverage :** ImportScreen ingestion réelle + 4 étapes + erreur/retry (T1) ✓ · helper progression testé (T1) ✓ · deep link ?import= (T2) ✓ · handleSaved refresh (T2) ✓ · share_target best-effort (T2) ✓ · guide iOS docs/ios-shortcut.md (T3) ✓ · lien AccountSheet + URL /api/ingest (T3) ✓.
- **Placeholders :** test fourni ; wiring + guide décrits précisément. Pas de TODO.
- **Type consistency :** `api.ingest/ingestStatus` (Spec 05) ; `progressFor` cohérent avec `STATUS_STEP` ; `onSaved`/`initialUrl` props ImportScreen.
