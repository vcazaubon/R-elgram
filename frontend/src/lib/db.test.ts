// ============================================================
// Réelgram — data layer tests (db.ts)
// createCategory must carry user_id: categories.user_id is NOT NULL with no
// default and RLS enforces `with check (auth.uid() = user_id)`, so an insert
// without it is always rejected (Bug: "la catégorie ne se crée pas").
// ./supabase and ./api are mocked so config.ts / window are never touched.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ state: { inserted: null as Record<string, unknown> | null, lastLimit: null as number | null } }));

vi.mock('./api', () => ({ deleteVideo: vi.fn() }));
vi.mock('./supabase', () => {
  const builder = () => ({
    select() { return this; },
    order() { return this; },
    limit(n: number) { h.state.lastLimit = n; return Promise.resolve({ data: [{ position: 2 }], error: null }); },
    insert(payload: Record<string, unknown>) { h.state.inserted = payload; return this; },
    single() { return Promise.resolve({ data: { id: 'c1', ...h.state.inserted }, error: null }); },
  });
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => builder(),
    },
  };
});

import * as db from './db';

beforeEach(() => { h.state.inserted = null; h.state.lastLimit = null; });

describe('createCategory', () => {
  it('includes user_id from the session so the RLS insert is accepted', async () => {
    await db.createCategory('Voyages');
    expect(h.state.inserted).toMatchObject({ user_id: 'user-1', label: 'Voyages' });
  });

  it('appends position after the current max and assigns a palette colour', async () => {
    await db.createCategory('Voyages');
    // max position is 2 (mock) -> next is 3; palette has 6 entries, index 3.
    expect(h.state.inserted).toMatchObject({ position: 3, color: '#5fa8ff' });
  });
});

describe('listVideos', () => {
  it('bounds the query to MAX_LIBRARY (1000) rows', async () => {
    await db.listVideos();
    expect(h.state.lastLimit).toBe(1000);
  });
});
