# UX d'ingestion en cours — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pendant l'ingestion d'un réel, la carte affiche un anneau de progression + l'étape en cours, et un toast confirme la fin (succès → ouvre le réel ; échec → ouvre la suppression), le tout fiabilisé par un poll de secours.

**Architecture:** Frontend pur (React + Vite PWA). Deux helpers purs testés (`STEP_LABELS`, `dashoffsetFor`) + un module pur testé `importToasts.ts` (`detectCompletions`). Un composant `Toast.tsx`. `VideoCard.tsx` gagne un overlay de progression. `App.tsx` orchestre la file de toasts, la détection de fin et le poll de secours. Aucun changement backend.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (`vitest run`). Styles inline + variables CSS (`--ease`, `--shadow-pop`, glassmorphism).

**Spec:** `docs/superpowers/specs/2026-06-08-ingestion-progress-ux-design.md`

**Commandes :**
- Tests ciblés : `cd /opt/Réelgram/frontend && npx vitest run <fichier>`
- Toute la suite : `cd /opt/Réelgram/frontend && npm test`
- Typecheck : `cd /opt/Réelgram/frontend && npx tsc -b`

**Conventions :** DRY, YAGNI, TDD, commits fréquents. Chaque commit se termine par
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Carte des fichiers

- **Modifier** `frontend/src/lib/ingestProgress.ts` — ajouter `STEP_LABELS` + `dashoffsetFor` (purs).
- **Modifier** `frontend/src/lib/ingestProgress.test.ts` — tests des deux helpers.
- **Créer** `frontend/src/lib/importToasts.ts` — `ToastKind`, `Completion`, `detectCompletions` (pur).
- **Créer** `frontend/src/lib/importToasts.test.ts` — tests de `detectCompletions`.
- **Créer** `frontend/src/components/Toast.tsx` — composant présentationnel (vérif visuelle).
- **Modifier** `frontend/src/components/VideoCard.tsx` — overlay anneau + étape pour les états en cours.
- **Modifier** `frontend/src/App.tsx` — file de toasts, détection de fin, poll de secours, rendu `<Toast>`.

Note : le repo n'a **pas** d'infra de test de rendu React → les composants (`Toast`, carte) sont vérifiés **manuellement** via le serveur de dev exposé ; seuls les modules purs sont testés en Vitest (cohérent avec l'existant).

---

### Task 1: Helpers purs pour la carte (`STEP_LABELS` + `dashoffsetFor`)

**Files:**
- Modify: `frontend/src/lib/ingestProgress.ts`
- Test: `frontend/src/lib/ingestProgress.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `frontend/src/lib/ingestProgress.test.ts`, remplacer la ligne d'import
`import { progressFor } from './ingestProgress';` par :

```ts
import { progressFor, STEP_LABELS, dashoffsetFor } from './ingestProgress';
```

Puis ajouter, à la fin du fichier (après le dernier `});` du `describe('progressFor')`) :

```ts
describe('STEP_LABELS', () => {
  it('labels the in-progress stages in French', () => {
    expect(STEP_LABELS.analyzing).toBe('Analyse…');
    expect(STEP_LABELS.fetching).toBe('Téléchargement…');
    expect(STEP_LABELS.thumbnailing).toBe('Aperçu…');
  });
});

describe('dashoffsetFor', () => {
  const r = 19;
  const circ = 2 * Math.PI * r;
  it('is the full circumference at 0% and 0 at 100%', () => {
    expect(dashoffsetFor(0, r)).toBeCloseTo(circ);
    expect(dashoffsetFor(100, r)).toBeCloseTo(0);
  });
  it('is half the circumference at 50%', () => {
    expect(dashoffsetFor(50, r)).toBeCloseTo(circ / 2);
  });
  it('clamps out-of-range percentages', () => {
    expect(dashoffsetFor(-10, r)).toBeCloseTo(circ);
    expect(dashoffsetFor(150, r)).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/frontend && npx vitest run src/lib/ingestProgress.test.ts`
Expected: FAIL — `STEP_LABELS`/`dashoffsetFor` non exportés (erreur de compilation / undefined).

- [ ] **Step 3: Implémenter les helpers**

Dans `frontend/src/lib/ingestProgress.ts`, ajouter à la fin du fichier (le type
`VideoStatus` est déjà importé en tête) :

```ts
// Libellés FR des étapes d'ingestion, affichés sur la carte en cours.
// 'ready'/'error' présents pour l'exhaustivité du type ; la carte n'affiche le
// libellé que pour les états en cours.
export const STEP_LABELS: Record<VideoStatus, string> = {
  analyzing: 'Analyse…',
  fetching: 'Téléchargement…',
  thumbnailing: 'Aperçu…',
  ready: 'Prêt',
  error: 'Erreur',
};

// stroke-dashoffset d'un anneau SVG pour un pourcentage 0..100 donné et un rayon.
// 0% → circonférence entière (anneau vide), 100% → 0 (anneau plein).
export function dashoffsetFor(percent: number, radius: number): number {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return circumference * (1 - clamped / 100);
}
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/frontend && npx vitest run src/lib/ingestProgress.test.ts`
Expected: PASS (tous les `describe`, anciens + nouveaux).

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add frontend/src/lib/ingestProgress.ts frontend/src/lib/ingestProgress.test.ts
git commit -m "feat(progress): STEP_LABELS + dashoffsetFor helpers for the in-progress card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Détection de fin d'import (`detectCompletions`)

**Files:**
- Create: `frontend/src/lib/importToasts.ts`
- Test: `frontend/src/lib/importToasts.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/lib/importToasts.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { detectCompletions } from './importToasts';
import type { Video } from './types';

function vid(id: string, status: Video['status'], title = 'Réel'): Video {
  return {
    id,
    category_id: null,
    source_url: 'https://x',
    title,
    author: null,
    duration_seconds: null,
    thumb_color: '#000',
    status,
    error: null,
    created_at: '2026-06-08T00:00:00Z',
  };
}

describe('detectCompletions', () => {
  it('flags a fetching → ready transition as success with the title', () => {
    const prev = [vid('a', 'fetching', 'Recette')];
    const next = [vid('a', 'ready', 'Recette')];
    expect(detectCompletions(prev, next)).toEqual([
      { id: 'a', kind: 'success', title: 'Recette' },
    ]);
  });

  it('flags a non-error → error transition as error', () => {
    const prev = [vid('a', 'thumbnailing')];
    const next = [vid('a', 'error')];
    expect(detectCompletions(prev, next)).toEqual([
      { id: 'a', kind: 'error', title: 'Réel' },
    ]);
  });

  it('ignores reels absent from prev (no spam on first load)', () => {
    const next = [vid('a', 'ready'), vid('b', 'error')];
    expect(detectCompletions([], next)).toEqual([]);
  });

  it('returns [] when nothing changed', () => {
    const prev = [vid('a', 'ready'), vid('b', 'fetching')];
    const next = [vid('a', 'ready'), vid('b', 'fetching')];
    expect(detectCompletions(prev, next)).toEqual([]);
  });

  it('returns [] while a reel is still in progress', () => {
    const prev = [vid('a', 'analyzing')];
    const next = [vid('a', 'fetching')];
    expect(detectCompletions(prev, next)).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/frontend && npx vitest run src/lib/importToasts.test.ts`
Expected: FAIL — `./importToasts` introuvable.

- [ ] **Step 3: Implémenter le module**

Créer `frontend/src/lib/importToasts.ts` :

```ts
// ============================================================
// Réelgram — détection de fin d'import (carte enrichie + toast de fin)
// Diff pur entre deux listes de vidéos : quels réels viennent de terminer
// (ready) ou d'échouer (error). Sans effet de bord → testé en Vitest.
// ============================================================
import type { Video } from './types';

export type ToastKind = 'success' | 'error';

export interface Completion {
  id: string;
  kind: ToastKind;
  title: string;
}

/**
 * Compare une liste `prev` et `next` et renvoie les réels ayant transité vers
 * un état terminal entre les deux instantanés :
 *  - non-'ready' → 'ready'  → { kind: 'success' }
 *  - non-'error' → 'error'  → { kind: 'error' }
 *
 * Un réel ABSENT de `prev` n'est pas une transition (jamais observé en cours) :
 * ouvrir l'app sur des réels déjà terminés n'émet donc rien (anti-spam).
 */
export function detectCompletions(prev: Video[], next: Video[]): Completion[] {
  const prevById = new Map(prev.map((v) => [v.id, v]));
  const out: Completion[] = [];
  for (const v of next) {
    const before = prevById.get(v.id);
    if (!before) continue; // nouvellement vu → pas une transition observée
    if (v.status === 'ready' && before.status !== 'ready') {
      out.push({ id: v.id, kind: 'success', title: v.title });
    } else if (v.status === 'error' && before.status !== 'error') {
      out.push({ id: v.id, kind: 'error', title: v.title });
    }
  }
  return out;
}
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/frontend && npx vitest run src/lib/importToasts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add frontend/src/lib/importToasts.ts frontend/src/lib/importToasts.test.ts
git commit -m "feat(toasts): detectCompletions — pure import-completion diff

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Composant `Toast`

**Files:**
- Create: `frontend/src/components/Toast.tsx`

Pas de test unitaire (composant présentationnel, pas d'infra RTL) → vérif via typecheck + manuel.

- [ ] **Step 1: Créer le composant**

Créer `frontend/src/components/Toast.tsx` :

```tsx
// ============================================================
// Réelgram — toast de fin d'import (succès / erreur)
// Présentationnel : affiche un toast en bas, au-dessus de la barre d'onglets.
// Tap → onTap (puis fermeture) ; auto-disparition après ~4 s. La file et les
// handlers vivent dans App.tsx. App rend UN Toast à la fois (keyé), ce qui
// ré-arme le timer à chaque nouveau toast.
// ============================================================
import { useEffect, useRef } from 'react';
import type { ToastKind } from '../lib/importToasts';
import { Icons } from './Icons';

export interface ToastProps {
  kind: ToastKind;
  title: string;
  onTap: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export function Toast({ kind, title, onTap, onDismiss }: ToastProps) {
  // Auto-disparition. onDismiss est lu via une ref pour ne pas relancer le
  // timer à chaque re-render (le timer s'arme une fois par toast monté).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const id = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, []);

  const success = kind === 'success';
  const label = success ? `« ${title} » ajouté` : "Échec de l'import";

  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <button
        className="rise"
        onClick={() => { onTap(); onDismiss(); }}
        style={{
          pointerEvents: 'auto',
          maxWidth: 420,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderRadius: 14,
          textAlign: 'left',
          color: '#fff',
          background: 'rgba(10,10,12,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: success ? 'rgba(120,220,150,0.16)' : 'rgba(255,93,108,0.16)',
            color: success ? '#7be0a0' : '#ff8a96',
          }}
        >
          {success ? <Icons.check size={16} /> : <Icons.close size={16} />}
        </span>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `cd /opt/Réelgram/frontend && npx tsc -b`
Expected: aucune erreur (le composant n'est pas encore monté ; on vérifie juste qu'il compile).

- [ ] **Step 3: Commit**

```bash
cd /opt/Réelgram
git add frontend/src/components/Toast.tsx
git commit -m "feat(toast): Toast component (success/error, bottom, auto-dismiss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Carte enrichie (overlay anneau + étape)

**Files:**
- Modify: `frontend/src/components/VideoCard.tsx`

Vérif via typecheck + manuel (pas de test de rendu).

- [ ] **Step 1: Ajouter les imports**

Dans `frontend/src/components/VideoCard.tsx`, après la ligne
`import { categoryFor, formatAuthor, formatDate, formatDuration } from '../lib/format';`
ajouter :

```tsx
import { progressFor, dashoffsetFor, STEP_LABELS } from '../lib/ingestProgress';
```

- [ ] **Step 2: Remplacer le bloc badge « ready / not-ready »**

Repérer le bloc conditionnel actuel (le commentaire `{/* duration (ready) OR processing badge (not ready) */}` suivi du ternaire `{ready ? (...) : (...)}`). Remplacer **tout le ternaire** (de `{ready ? (` jusqu'au `)}` fermant, juste avant `</div>` qui ferme le conteneur `aspectRatio`) par ce ternaire à trois branches. La branche `ready` (badge durée) et la branche `error` (badge « Erreur ») sont **identiques à l'existant** ; seule la 3ᵉ branche (en cours) est nouvelle :

```tsx
{ready ? (
  <span
    style={{
      position: 'absolute',
      bottom: 12,
      right: 12,
      height: 24,
      padding: '0 9px',
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 7,
      fontSize: 12,
      fontWeight: 600,
      color: '#fff',
      background: 'rgba(10,10,12,0.5)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.12)',
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {formatDuration(video.duration_seconds)}
  </span>
) : video.status === 'error' ? (
  <span
    style={{
      position: 'absolute',
      bottom: 12,
      right: 12,
      height: 24,
      padding: '0 10px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: 7,
      fontSize: 12,
      fontWeight: 600,
      color: '#ff8a96',
      background: 'rgba(10,10,12,0.5)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.12)',
      letterSpacing: '0.06em',
    }}
  >
    Erreur
  </span>
) : (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      background: 'rgba(8,8,10,0.4)',
      backdropFilter: 'blur(2px)',
      WebkitBackdropFilter: 'blur(2px)',
    }}
  >
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="4" />
      <circle
        cx="23"
        cy="23"
        r="19"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={2 * Math.PI * 19}
        strokeDashoffset={dashoffsetFor(progressFor(video.status).percent, 19)}
        style={{ transition: 'stroke-dashoffset 0.5s var(--ease)' }}
      />
    </svg>
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.4)',
      }}
    >
      {STEP_LABELS[video.status]}
    </span>
  </div>
)}
```

- [ ] **Step 3: Réduire le grisé pour les cartes en cours**

Dans le `return` du cas `!ready` (le `<div className="rise" aria-disabled="true" ...>`),
remplacer `opacity: 0.78,` par :

```tsx
opacity: video.status === 'error' ? 0.78 : 1,
```

(les cartes en erreur restent légèrement grisées ; les cartes en cours sont en
opacité pleine, l'overlay suffisant à signaler le travail.)

- [ ] **Step 4: Vérifier le typecheck**

Run: `cd /opt/Réelgram/frontend && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add frontend/src/components/VideoCard.tsx
git commit -m "feat(card): progress ring + step label overlay while ingesting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Orchestration dans `App.tsx` (file de toasts + détection + poll)

**Files:**
- Modify: `frontend/src/App.tsx`

Vérif via typecheck + suite Vitest + manuel.

- [ ] **Step 1: Ajouter les imports**

Dans `frontend/src/App.tsx`, après `import { AccountSheet } from './screens/AccountSheet';`
ajouter :

```tsx
import { Toast } from './components/Toast';
import { detectCompletions, type Completion } from './lib/importToasts';
```

- [ ] **Step 2: Ajouter l'état file de toasts + ref snapshot**

Dans `AppShell`, juste après la ligne `const [importUrl, setImportUrl] = useState<string | undefined>(undefined);`
ajouter :

```tsx
// File de toasts de fin d'import (un affiché à la fois) + snapshot précédent
// des vidéos pour détecter les transitions.
const [toasts, setToasts] = useState<Completion[]>([]);
const prevVideosRef = useRef<Video[] | null>(null);
```

- [ ] **Step 3: Détection de fin + poll de secours (effets)**

Juste après l'effet `subscribeVideos` (la ligne
`useEffect(() => db.subscribeVideos(() => { void refresh(); }), [refresh]);`),
ajouter ces deux effets :

```tsx
// Détecte les transitions vers ready/error entre deux instantanés de `videos`
// et empile les toasts correspondants. Premier rendu : snapshot silencieux
// (aucun toast pour les vidéos déjà terminées au lancement).
useEffect(() => {
  const prev = prevVideosRef.current;
  prevVideosRef.current = videos;
  if (prev === null) return;
  const done = detectCompletions(prev, videos);
  if (done.length) setToasts((q) => [...q, ...done]);
}, [videos]);

// Poll de secours : tant qu'au moins un import est en cours ET que l'app est
// au premier plan, rafraîchit toutes les 2 s en plus du realtime. S'arrête dès
// qu'il n'y a plus rien en cours (refresh est idempotent).
useEffect(() => {
  const inflight = videos.some((v) => v.status !== 'ready' && v.status !== 'error');
  if (!inflight || document.visibilityState !== 'visible') return;
  const id = setInterval(() => { void refresh(); }, 2000);
  return () => clearInterval(id);
}, [videos, refresh]);
```

- [ ] **Step 4: Handlers de toast**

Juste avant le `return (` de `AppShell` (après la fonction `openImport`), ajouter :

```tsx
const activeToast = toasts[0] ?? null;
const dismissToast = () => setToasts((q) => q.slice(1));
const handleToastTap = () => {
  if (!activeToast) return;
  const v = videos.find((x) => x.id === activeToast.id);
  if (!v) return; // supprimé entre-temps
  if (activeToast.kind === 'success') void openVideo(v);
  else setPendingDelete(v);
};
```

- [ ] **Step 5: Rendre le toast**

Dans le JSX de `AppShell`, juste avant le bloc `{pendingDelete && (`, ajouter :

```tsx
{activeToast && (
  <Toast
    key={activeToast.id + activeToast.kind}
    kind={activeToast.kind}
    title={activeToast.title}
    onTap={handleToastTap}
    onDismiss={dismissToast}
  />
)}
```

(Le `key` force le remontage du `Toast` quand le toast actif change → ré-arme le
timer d'auto-disparition.)

- [ ] **Step 6: Typecheck + suite complète**

Run: `cd /opt/Réelgram/frontend && npx tsc -b && npm test`
Expected: typecheck sans erreur ; tous les tests Vitest passent (anciens +
`ingestProgress` étendu + `importToasts`).

- [ ] **Step 7: Commit**

```bash
cd /opt/Réelgram
git add frontend/src/App.tsx
git commit -m "feat(app): wire import toasts (queue + detection) + fallback poll

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Vérification manuelle (serveur de dev)

**Files:** aucun (vérification).

- [ ] **Step 1: Lancer le build de prod pour valider l'ensemble**

Run: `cd /opt/Réelgram/frontend && npm run build`
Expected: `tsc -b` + `vite build` réussissent sans erreur.

- [ ] **Step 2: Checklist manuelle (serveur de dev exposé, cf. mémoire « dev server », port 10009)**

Vérifier (idéalement avec un vrai partage de réel, ou en simulant des statuts) :
- Une carte en cours affiche l'anneau + le libellé d'étape (plus de « … » grisé).
- L'anneau avance au fil des étapes ; il se fige en arrêtant le poll quand tout est prêt.
- À la fin : toast « ✓ « *titre* » ajouté » en bas → tap ouvre le réel.
- Sur un échec : toast « Échec de l'import » → tap ouvre la confirmation de suppression.
- Au lancement de l'app sur des réels déjà prêts : **aucun** toast.

> Cette tâche n'a pas de commit (vérification). Si un défaut visuel apparaît,
> le corriger dans le fichier concerné et committer avec un message `fix(...)`.

---

## Self-review (couverture spec)

- **Carte : anneau + libellé d'étape, sans %** → Task 1 (`STEP_LABELS`, `dashoffsetFor`) + Task 4 (overlay). ✓
- **Toast bas, tap ouvre le réel, libellé avec titre** → Task 3 (`Toast`) + Task 5 (handler `success` → `openVideo`). ✓
- **Toast d'erreur, tap → confirmation de suppression** → Task 3 (variante erreur) + Task 5 (handler `error` → `setPendingDelete`). ✓
- **Anti-spam au lancement (snapshot silencieux)** → Task 2 (`detectCompletions` ignore les ids absents de `prev`) + Task 5 (premier rendu = snapshot). ✓
- **Fiabilité : realtime + poll de secours ~2 s, à l'arrêt sinon / en arrière-plan** → Task 5 (effet poll gardé par `inflight` + `visibilityState`). ✓
- **File : un toast à la fois** → Task 5 (`toasts[0]`, `dismissToast` dépile). ✓
- **Aucun changement backend** → aucune tâche backend. ✓
- **Tests purs cohérents avec l'existant** → Tasks 1-2 (Vitest) ; composants vérifiés manuellement (Task 6). ✓

Cohérence des types/signatures : `ToastKind`/`Completion` définis dans
`importToasts.ts` et réutilisés par `Toast.tsx` (`ToastKind`) et `App.tsx`
(`Completion`). `progressFor`/`dashoffsetFor`/`STEP_LABELS` exportés par
`ingestProgress.ts` et consommés par `VideoCard.tsx`. `detectCompletions(prev,
next)` même signature entre définition (Task 2) et usage (Task 5). ✓
