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
