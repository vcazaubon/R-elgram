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
