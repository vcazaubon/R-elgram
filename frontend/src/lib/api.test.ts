// ============================================================
// Réelgram — API client tests (Spec 05 T1)
// Backend client over fetch: prefixes config.apiUrl, attaches the
// Supabase JWT via an injectable token getter, parses JSON, throws on
// non-ok with the backend `detail`. global.fetch is mocked.
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §5
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vitest runs in a `node` environment (see vitest.config.ts), but api.ts
// imports config.ts which reads `window.__ENV__` at module load. Provide a
// minimal window before the api import is evaluated. vi.hoisted runs before
// the (hoisted) import statements, so config sees a defined window.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  if (typeof g.window === 'undefined') g.window = { __ENV__: {} } as unknown;
});

import * as api from './api';

beforeEach(() => {
  api.setAuthTokenGetter(async () => 'JWT123');
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn();
});

describe('ingest', () => {
  it('POSTs with Bearer + body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v1', status: 'analyzing' }),
    });
    const r = await api.ingest('https://instagram.com/reel/x', 'cat1');
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/ingest');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer JWT123');
    expect(JSON.parse(opts.body)).toEqual({
      url: 'https://instagram.com/reel/x',
      category_id: 'cat1',
    });
    expect(r.id).toBe('v1');
  });

  it('omits category_id from body when not provided', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v2', status: 'analyzing' }),
    });
    await api.ingest('https://instagram.com/reel/y');
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ url: 'https://instagram.com/reel/y' });
  });

  it('sets Content-Type on a JSON body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v1', status: 'analyzing' }),
    });
    await api.ingest('x');
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
});

describe('ingestStatus', () => {
  it('GETs the status endpoint', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'fetching', step: 1, error: null }),
    });
    const r = await api.ingestStatus('v1');
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/ingest/v1/status');
    // No method => GET; no body.
    expect(opts?.method ?? 'GET').toBe('GET');
    expect(opts?.body).toBeUndefined();
    expect(r.step).toBe(1);
  });
});

describe('getMediaUrl', () => {
  it('GETs media-url', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stream_url: '/s?t=1', thumb_url: '/t?t=1' }),
    });
    const r = await api.getMediaUrl('v1');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      '/api/videos/v1/media-url',
    );
    expect(r.stream_url).toBe('/s?t=1');
    expect(r.thumb_url).toBe('/t?t=1');
  });
});

describe('deleteVideo', () => {
  it('DELETEs the video and does not parse a 204 body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body to parse');
      },
    });
    await expect(api.deleteVideo('v1')).resolves.toBeUndefined();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/videos/v1');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.Authorization).toBe('Bearer JWT123');
  });
});

describe('tokens', () => {
  it('listTokens GETs /api/tokens', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 't1', label: 'iOS', created_at: 'x', last_used_at: null }],
    });
    const r = await api.listTokens();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/tokens');
    expect(r[0].id).toBe('t1');
  });

  it('createToken POSTs label and returns plaintext once', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 't2', token: 'plaintext-secret' }),
    });
    const r = await api.createToken('Mon iPhone');
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/tokens');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ label: 'Mon iPhone' });
    expect(r.token).toBe('plaintext-secret');
  });

  it('createToken POSTs an empty body when no label', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 't3', token: 'secret' }),
    });
    await api.createToken();
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({});
  });

  it('deleteToken DELETEs /api/tokens/:id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body');
      },
    });
    await expect(api.deleteToken('t1')).resolves.toBeUndefined();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/tokens/t1');
    expect(opts.method).toBe('DELETE');
  });
});

describe('auth header', () => {
  it('omits Authorization when no token is available', async () => {
    api.setAuthTokenGetter(async () => null);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v1', status: 'analyzing' }),
    });
    await api.ingest('x');
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('tolerates a getter that throws (sends no Authorization)', async () => {
    api.setAuthTokenGetter(async () => {
      throw new Error('session boom');
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v1', status: 'analyzing' }),
    });
    await api.ingest('x');
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });
});

describe('error handling', () => {
  it('throws on non-ok with the backend detail', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'bad' }),
    });
    await expect(api.ingest('x')).rejects.toThrow(/bad/);
  });

  it('throws a generic message when the error body has no detail', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(api.ingest('x')).rejects.toBeTruthy();
  });
});
