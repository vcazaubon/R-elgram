# Library Lazy Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Réelgram library scale to several hundred videos by loading thumbnails on demand (only near the viewport) and skipping render of off-screen cards — without preloading any video and without changing the visual design.

**Architecture:** Approach A (zero new dependency, pixel-perfect). A pure `ThumbnailLoader` (dedupe + cache) feeds React state; a tiny `useInView` hook (IntersectionObserver) decides when a card requests its thumbnail; CSS `content-visibility: auto` provides native windowing. The eager `Promise.all` that fetched every thumbnail at load is removed. Metadata stays fully in memory, bounded to 1000 rows.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (node environment — pure-logic tests only), Supabase JS client. No new npm dependency.

**Reference spec:** `docs/superpowers/specs/2026-06-08-library-lazy-display-design.md`

---

## File Structure

- **Create** `frontend/src/lib/thumbnails.ts` — pure thumbnail loader (dedupe in-flight, cache resolved, don't cache failures). No React/DOM.
- **Create** `frontend/src/lib/thumbnails.test.ts` — unit tests for the loader.
- **Create** `frontend/src/lib/useInView.ts` — `IntersectionObserver` hook (sticky true on first intersection).
- **Modify** `frontend/src/lib/db.ts` — bound `listVideos()` to `MAX_LIBRARY = 1000` rows.
- **Modify** `frontend/src/lib/db.test.ts` — capture the `.limit()` argument; assert `listVideos` bounds to 1000.
- **Modify** `frontend/src/components/VideoCard.tsx` — ref + `useInView` → `onThumbVisible(id)` for ready cards; `content-visibility` on the wrapper; cap the entrance-stagger delay.
- **Modify** `frontend/src/screens/LibraryScreen.tsx` — forward `onThumbVisible` to each card.
- **Modify** `frontend/src/App.tsx` — remove the eager thumbnail effect; instantiate the loader; expose `onThumbVisible`; wire it to `LibraryScreen`.

Task order keeps the tree compiling at every step: pure logic first (Tasks 1–2), then the hook (Task 3), then the leaf component (Task 4), then its parent (Task 5), then the App integration that activates lazy loading (Task 6).

---

## Task 1: Bound the metadata fetch to 1000 rows

**Files:**
- Modify: `frontend/src/lib/db.ts:29-35` (`listVideos`)
- Test: `frontend/src/lib/db.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `frontend/src/lib/db.test.ts`. First extend the hoisted state and the mock's `limit` to record its argument, and reset it between tests.

Change the hoisted declaration (line 10) to:

```ts
const h = vi.hoisted(() => ({ state: { inserted: null as Record<string, unknown> | null, lastLimit: null as number | null } }));
```

Change the mock's `limit` method (line 17) to record the argument while still resolving (so `createCategory`'s position query keeps working):

```ts
    limit(n: number) { h.state.lastLimit = n; return Promise.resolve({ data: [{ position: 2 }], error: null }); },
```

Change `beforeEach` (line 31) to:

```ts
beforeEach(() => { h.state.inserted = null; h.state.lastLimit = null; });
```

Append a new describe block at the end of the file:

```ts
describe('listVideos', () => {
  it('bounds the query to MAX_LIBRARY (1000) rows', async () => {
    await db.listVideos();
    expect(h.state.lastLimit).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/db.test.ts -t "bounds the query"`
Expected: FAIL — `expected null to be 1000` (current `listVideos` never calls `.limit()`).

- [ ] **Step 3: Write minimal implementation**

Edit `frontend/src/lib/db.ts`. Add a constant above `listVideos` (after the `// ---- videos ----` banner, ~line 27) and add `.limit(MAX_LIBRARY)` to the chain:

```ts
// ---- videos -----------------------------------------------------------------

/**
 * Upper bound on the in-memory library. The whole table is held client-side
 * (search/filter are local), so we cap reads at an explicit ceiling instead of
 * relying on Supabase's silent 1000-row default. Beyond this, switch to
 * server-side pagination (out of scope for the current ≤1000 target).
 */
const MAX_LIBRARY = 1000;

/** All videos for the current account, newest first (capped at MAX_LIBRARY). */
export async function listVideos(): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(MAX_LIBRARY);
  return unwrap(data, error) ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/db.test.ts`
Expected: PASS — the new test plus the two existing `createCategory` tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/db.ts frontend/src/lib/db.test.ts
git commit -m "$(printf 'feat(db): bound listVideos to MAX_LIBRARY (1000) rows\n\nReplace Supabase'\''s silent 1000-row default with an explicit, documented\nceiling. Whole table stays in memory (client-side search/filter).\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Pure thumbnail loader (dedupe + cache)

**Files:**
- Create: `frontend/src/lib/thumbnails.ts`
- Test: `frontend/src/lib/thumbnails.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/thumbnails.test.ts`:

```ts
// ============================================================
// Réelgram — thumbnail loader tests (thumbnails.ts)
// Pure logic: fetch is injected, onResolved is captured. Covers dedupe of
// in-flight requests, caching of resolved URLs, and "failures are not cached
// (retryable)". Node env — no React/DOM.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { createThumbnailLoader } from './thumbnails';

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createThumbnailLoader', () => {
  it('dedupes concurrent requests for the same id (fetch called once)', () => {
    const d = deferred<string>();
    const fetch = vi.fn(() => d.promise);
    const loader = createThumbnailLoader({ fetch, onResolved: () => {} });

    loader.request('a');
    loader.request('a'); // in-flight → must not fetch again

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches the resolved url and calls onResolved once; no refetch afterwards', async () => {
    const d = deferred<string>();
    const fetch = vi.fn(() => d.promise);
    const resolved: Array<[string, string]> = [];
    const loader = createThumbnailLoader({ fetch, onResolved: (id, url) => resolved.push([id, url]) });

    loader.request('a');
    d.resolve('url-a');
    await d.promise; // let the loader's then() run

    expect(resolved).toEqual([['a', 'url-a']]);
    expect(loader.has('a')).toBe(true);

    loader.request('a'); // cached → no second fetch
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures; a later request retries', async () => {
    const d = deferred<string>();
    const fetch = vi.fn(() => d.promise);
    const loader = createThumbnailLoader({ fetch, onResolved: () => {} });

    loader.request('b');
    d.reject(new Error('boom'));
    await d.promise.catch(() => {}); // swallow rejection in the test
    await Promise.resolve(); // flush the loader's finally()

    expect(loader.has('b')).toBe(false);

    loader.request('b'); // retryable
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/thumbnails.test.ts`
Expected: FAIL — `Failed to resolve import './thumbnails'` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/thumbnails.ts`:

```ts
// ============================================================
// Réelgram — thumbnail loader (lazy, on demand)
// Replaces App's eager Promise.all over every ready video. A card asks for its
// thumbnail only when it nears the viewport (cf. useInView); this loader dedupes
// concurrent/repeat requests, caches resolved URLs by videoId, and deliberately
// does NOT cache failures so a card can retry when it scrolls back into view.
// Pure logic (no React/DOM): `fetch` and `onResolved` are injected by App.
// cf. docs/superpowers/specs/2026-06-08-library-lazy-display-design.md §1
// ============================================================

export interface ThumbnailLoader {
  /** Request the thumbnail for `id`. No-op if already resolved or in flight. */
  request(id: string): void;
  /** True once `id` has a resolved (cached) URL. */
  has(id: string): boolean;
}

export interface ThumbnailLoaderOptions {
  /** Resolve a video's thumbnail URL (= api.getMediaUrl(id) → thumb_url). */
  fetch: (id: string) => Promise<string>;
  /** Called once the URL is resolved, to push it into React state. */
  onResolved: (id: string, url: string) => void;
}

export function createThumbnailLoader(opts: ThumbnailLoaderOptions): ThumbnailLoader {
  const cache = new Map<string, string>();
  const inflight = new Set<string>();

  function request(id: string): void {
    if (cache.has(id) || inflight.has(id)) return;
    inflight.add(id);
    void (async () => {
      try {
        const url = await opts.fetch(id);
        cache.set(id, url);
        opts.onResolved(id, url);
      } catch {
        // Don't cache: a future request(id) retries when the card reappears.
      } finally {
        inflight.delete(id);
      }
    })();
  }

  return {
    request,
    has: (id: string) => cache.has(id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/thumbnails.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/thumbnails.ts frontend/src/lib/thumbnails.test.ts
git commit -m "$(printf 'feat(thumbnails): pure on-demand thumbnail loader (dedupe + cache)\n\nDedupes in-flight/repeat requests, caches resolved URLs by videoId, never\ncaches failures (retryable). Injected fetch/onResolved keep it React-free\nand unit-testable in the node vitest env.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `useInView` hook (IntersectionObserver)

**Files:**
- Create: `frontend/src/lib/useInView.ts`

> No vitest coverage: the project's vitest env is `node` (no jsdom), so DOM hooks are out of the test surface. Verification here is a typecheck; behavior is verified manually in Task 6.

- [ ] **Step 1: Write the hook**

Create `frontend/src/lib/useInView.ts`:

```ts
// ============================================================
// Réelgram — useInView (IntersectionObserver, sticky)
// Returns true once the observed element first intersects the viewport (plus
// rootMargin), then stays true and disconnects — a card needs to ask for its
// thumbnail once, not toggle. Degrades to immediately-true when
// IntersectionObserver is unavailable (never leaves a blank card).
// cf. docs/superpowers/specs/2026-06-08-library-lazy-display-design.md §2
// ============================================================
import { useEffect, useState } from 'react';

export function useInView(
  ref: { current: Element | null },
  options: { rootMargin?: string } = {},
): boolean {
  const [inView, setInView] = useState(false);
  const rootMargin = options.rootMargin ?? '0px';

  useEffect(() => {
    if (inView) return; // sticky: already seen — nothing left to observe
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true); // no API → load eagerly rather than show nothing
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, inView, rootMargin]);

  return inView;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc -b`
Expected: completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/useInView.ts
git commit -m "$(printf 'feat(hooks): useInView — sticky IntersectionObserver hook\n\nTrue on first viewport intersection (+rootMargin), then disconnects.\nDegrades to immediately-true without IntersectionObserver.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: VideoCard requests its thumbnail lazily + native windowing

**Files:**
- Modify: `frontend/src/components/VideoCard.tsx`

> `onThumbVisible` is added as **optional** so the tree keeps compiling before App wires it (Task 6). Only `ready` cards request a thumbnail (non-ready cards show the progress overlay). `content-visibility` is applied to **both** wrapper variants for windowing.

- [ ] **Step 1: Add imports and the in-view wiring**

Edit the import block at the top of `frontend/src/components/VideoCard.tsx`. Change line 9:

```ts
import { useRef } from 'react';
```

to:

```ts
import { useCallback, useEffect, useRef } from 'react';
import { useInView } from '../lib/useInView';
```

- [ ] **Step 2: Add the `onThumbVisible` prop**

In `VideoCardProps` (ends ~line 28), add the optional prop after `onRequestDelete`:

```ts
  onRequestDelete?: (video: Video) => void;
  /**
   * Called when a ready card nears the viewport, so the parent can resolve its
   * thumbnail on demand (lazy). Optional: cards still render (gradient fallback)
   * if no resolver is wired.
   */
  onThumbVisible?: (id: string) => void;
```

- [ ] **Step 3: Destructure the prop and set up the in-view ref**

Change the function signature (line 32):

```ts
export function VideoCard({ video, index, categories, thumbUrl, onOpen, onRequestDelete }: VideoCardProps) {
  const cat = categoryFor(video.category_id, categories);
  const ready = video.status === 'ready';
```

to:

```ts
export function VideoCard({ video, index, categories, thumbUrl, onOpen, onRequestDelete, onThumbVisible }: VideoCardProps) {
  const cat = categoryFor(video.category_id, categories);
  const ready = video.status === 'ready';

  // Lazy thumbnail: a callback ref (typed Element so it attaches to either the
  // <button> or the <div> variant) feeds useInView; when a ready card nears the
  // viewport we ask the parent to resolve its thumbnail. rootMargin pre-loads a
  // little ahead of scroll. Off-screen cards keep their thumb_color gradient.
  const cardRef = useRef<Element | null>(null);
  const setCardRef = useCallback((el: Element | null) => { cardRef.current = el; }, []);
  const inView = useInView(cardRef, { rootMargin: '200px 0px' });
  useEffect(() => {
    if (inView && ready && onThumbVisible) onThumbVisible(video.id);
  }, [inView, ready, onThumbVisible, video.id]);

  // Cap the entrance-stagger so far-down cards don't inherit absurd delays
  // (index 500 → 20s). content-visibility means they paint when scrolled in.
  const enterDelay = `${0.04 * Math.min(index, 12)}s`;
```

- [ ] **Step 4: Attach the ref + content-visibility + capped delay on the not-ready wrapper**

Replace the not-ready wrapper `<div>` opening (lines 236-246) so it carries the ref, native windowing, and the capped delay:

```tsx
    return (
      <div
        className="rise"
        ref={setCardRef}
        aria-disabled="true"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, opacity: video.status === 'error' ? 0.78 : 1, animationDelay: enterDelay, contentVisibility: 'auto', containIntrinsicSize: 'auto 320px', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {body}
      </div>
    );
```

- [ ] **Step 5: Attach the ref + content-visibility + capped delay on the ready wrapper**

Replace the ready wrapper `<button>` opening (lines 252-273) so it carries the ref, native windowing, and the capped delay:

```tsx
  return (
    <button
      className="rise"
      ref={setCardRef}
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 0,
        animationDelay: enterDelay,
        // Native windowing: the browser skips layout/paint of off-screen cards
        // (their backdrop-filter blur is the expensive part). `auto` lets it
        // remember the real size once painted → stable scrollbar.
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 320px',
        WebkitTouchCallout: 'none',
        // Both are required: React doesn't auto-prefix, and iOS Safari needs the
        // -webkit- form to stop the long-press from triggering text selection.
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {body}
    </button>
  );
```

- [ ] **Step 6: Verify it typechecks**

Run: `cd frontend && npx tsc -b`
Expected: completes with no errors. (If `contentVisibility`/`containIntrinsicSize` are flagged by an older csstype, that's a real signal — do not cast around it without checking; the bundled csstype in @types/react 18.3 includes both.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/VideoCard.tsx
git commit -m "$(printf 'feat(card): lazy thumbnail request + content-visibility windowing\n\nReady cards ask the parent to resolve their thumbnail only when they near\nthe viewport (useInView, 200px margin). content-visibility:auto skips\noff-screen layout/paint. Entrance stagger capped to the first 12 cards.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: LibraryScreen forwards `onThumbVisible`

**Files:**
- Modify: `frontend/src/screens/LibraryScreen.tsx`

> Added as **optional** so App can wire it in Task 6 without breaking compilation here.

- [ ] **Step 1: Add the prop to the interface**

In `LibraryScreenProps` (ends ~line 30), add after `onAccount: () => void;`:

```ts
  onAccount: () => void;
  /** Forwarded to each card: resolve a thumbnail when the card nears view. */
  onThumbVisible?: (id: string) => void;
```

- [ ] **Step 2: Destructure and forward it**

Change the function signature (line 32):

```ts
export function LibraryScreen({ videos, categories, thumbUrls, loading, onOpen, onRequestDelete, onAdd, onTab, tab, onAccount }: LibraryScreenProps) {
```

to:

```ts
export function LibraryScreen({ videos, categories, thumbUrls, loading, onOpen, onRequestDelete, onAdd, onTab, tab, onAccount, onThumbVisible }: LibraryScreenProps) {
```

Change the card render (line 110):

```tsx
          ) : filtered.map((v, i) => (
            <VideoCard key={v.id} video={v} index={i} categories={categories} thumbUrl={thumbUrls[v.id]} onOpen={onOpen} onRequestDelete={onRequestDelete} onThumbVisible={onThumbVisible} />
          ))}
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd frontend && npx tsc -b`
Expected: completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/LibraryScreen.tsx
git commit -m "$(printf 'feat(library): forward onThumbVisible to each card\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: App integration — remove eager fetch, wire the loader

**Files:**
- Modify: `frontend/src/App.tsx`

This task removes the eager `Promise.all` and activates lazy loading end-to-end.

- [ ] **Step 1: Import the loader**

Edit the import on line 20 of `frontend/src/App.tsx`:

```ts
import { setAuthTokenGetter, getMediaUrl } from './lib/api';
```

Leave it as-is, and add a new import line right after it:

```ts
import { setAuthTokenGetter, getMediaUrl } from './lib/api';
import { createThumbnailLoader, type ThumbnailLoader } from './lib/thumbnails';
```

- [ ] **Step 2: Instantiate the loader and expose `onThumbVisible`**

In `AppShell`, just after the `thumbUrls` state (line 127):

```ts
  // videoId → signed thumbnail URL, resolved on demand for ready videos.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
```

add the lazy loader (created once; `setThumbUrls` is a stable setter so the
closure stays valid across renders):

```ts
  // videoId → signed thumbnail URL, resolved on demand for ready videos.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  // Lazy thumbnail loader: a card calls onThumbVisible when it nears the
  // viewport; the loader dedupes + caches and pushes resolved URLs into
  // thumbUrls. Replaces the old eager Promise.all over every ready video.
  const thumbLoaderRef = useRef<ThumbnailLoader | null>(null);
  if (!thumbLoaderRef.current) {
    thumbLoaderRef.current = createThumbnailLoader({
      fetch: (id) => getMediaUrl(id).then((m) => m.thumb_url),
      onResolved: (id, url) => setThumbUrls((prev) => ({ ...prev, [id]: url })),
    });
  }
  const onThumbVisible = useCallback((id: string) => thumbLoaderRef.current!.request(id), []);
```

- [ ] **Step 3: Remove the eager thumbnail effect**

Delete the entire effect at lines 241-262 (the `// Resolve thumbnail URLs for ready videos…` block):

```ts
  // Resolve thumbnail URLs for ready videos we haven't fetched yet.
  useEffect(() => {
    let active = true;
    const pending = videos.filter((v) => v.status === 'ready' && !thumbUrls[v.id]);
    if (pending.length === 0) return;
    void Promise.all(
      pending.map(async (v) => {
        try {
          const { thumb_url } = await getMediaUrl(v.id);
          return [v.id, thumb_url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      if (Object.keys(next).length) setThumbUrls((prev) => ({ ...prev, ...next }));
    });
    return () => { active = false; };
  }, [videos, thumbUrls]);
```

- [ ] **Step 4: Pass `onThumbVisible` to LibraryScreen**

Change the `<LibraryScreen>` usage (lines 366-368):

```tsx
            : <LibraryScreen videos={videos} categories={categories} thumbUrls={thumbUrls} loading={loading}
                tab="library" onTab={onTab} onOpen={openVideo} onRequestDelete={setPendingDelete}
                onAdd={openImport} onAccount={() => setAccountOpen(true)} />
```

to:

```tsx
            : <LibraryScreen videos={videos} categories={categories} thumbUrls={thumbUrls} loading={loading}
                tab="library" onTab={onTab} onOpen={openVideo} onRequestDelete={setPendingDelete}
                onAdd={openImport} onAccount={() => setAccountOpen(true)} onThumbVisible={onThumbVisible} />
```

- [ ] **Step 5: Verify the whole project typechecks and tests pass**

Run: `cd frontend && npx tsc -b && npx vitest run`
Expected: typecheck clean; all test files pass (including the new `thumbnails.test.ts` and the `db.test.ts` limit test). If `getMediaUrl` is now reported as unused, it is still used by `openVideo` and the loader's `fetch` — re-check the edits rather than removing the import.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "$(printf 'refactor(app): lazy thumbnails — drop eager Promise.all, wire loader\n\nThumbnails now resolve on demand as cards near the viewport (onThumbVisible\n→ ThumbnailLoader), instead of fetching every ready video'\''s media-url at\nload. Cache persists across realtime/foreground refetches.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 7: Manual verification on the dev server (acceptance check)**

The lazy/windowing behavior is DOM-level and not covered by vitest. Verify it by hand against the dev server (Vite, port 10009; cf. project memory — use `VITE_API_PROXY`, the service_role Supabase key):

```bash
cd frontend && npm run dev -- --port 10009
```

Check, with a library of at least ~100 ready videos:
1. **Network tab on first load:** only the thumbnails of the first screenful (+200px) issue `…/media-url` + `…/thumb` requests — NOT all videos. Scrolling down triggers the rest progressively.
2. **No video request at the library level** (only when a card is opened) — unchanged.
3. **Visual parity:** cards, spacing, entrance animation and scroll look identical to before; off-screen cards show the `thumb_color` gradient until scrolled near.
4. **Filter/search:** switching category chips still filters instantly; thumbnails already resolved are reused.

If any of 1–4 fails, treat it as a bug and debug before considering the plan complete.

---

## Self-Review

**Spec coverage:**
- Spec §1 `thumbnails.ts` loader → Task 2 ✓
- Spec §2 `useInView.ts` → Task 3 ✓
- Spec §3 VideoCard (ref, useInView, onThumbVisible, content-visibility, stagger cap) → Task 4 ✓
- Spec §4 LibraryScreen forward → Task 5 ✓
- Spec §5 App (remove Promise.all, loader, wire) → Task 6 ✓
- Spec §6 db.ts `.limit(1000)` → Task 1 ✓
- Spec "Tests" → `thumbnails.test.ts` (Task 2), `db.test.ts` (Task 1), manual dev-server check (Task 6 Step 7) ✓
- Acceptance criteria 1–6 → covered by Task 6 Step 5 (tests, zero new dep) + Step 7 (manual: lazy load, no preload, visual parity) + Task 1 (limit) + audit notes (delete unchanged) ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `ThumbnailLoader` / `ThumbnailLoaderOptions` / `createThumbnailLoader({ fetch, onResolved })` / `request(id)` / `has(id)` are identical across Task 2, the spec, and Task 6's usage. `useInView(ref, { rootMargin })` signature matches Task 3 ↔ Task 4. `onThumbVisible?: (id: string) => void` matches across VideoCard (Task 4), LibraryScreen (Task 5), App (Task 6). `MAX_LIBRARY` defined once in Task 1. ✓
