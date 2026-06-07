// ============================================================
// Réelgram — Supabase data layer (Spec 05)
// Typed CRUD over the `videos` / `categories` tables. RLS is implicit:
// the singleton Supabase client carries the user session, so every query is
// scoped to `user_id = auth.uid()` by policy (cf. design maître §4).
//
// Read + metadata mutations live here (Supabase direct). The video file path
// (ingest / media URLs / full delete) goes through the backend (api.ts).
// deleteVideo deliberately delegates to api.deleteVideo: deleting a row here
// would orphan the file + thumbnail on disk — the backend purges all three
// (Spec 06). No direct Supabase delete of a video is ever issued.
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §2, §4
// ============================================================
import { supabase } from './supabase';
import * as api from './api';
import type { Category, Video } from './types';

// ---- helpers ----------------------------------------------------------------

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  // Supabase returns null data only on error; the cast is safe post-check.
  return data as T;
}

// ---- videos -----------------------------------------------------------------

/** All videos for the current account, newest first. */
export async function listVideos(): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false });
  return unwrap(data, error) ?? [];
}

/** Editable video fields (rename / recategorise). */
export interface VideoUpdate {
  title?: string;
  category_id?: string | null;
}

/** Patch a video's metadata; returns the updated row. */
export async function updateVideo(id: string, fields: VideoUpdate): Promise<Video> {
  const { data, error } = await supabase
    .from('videos')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  return unwrap(data, error);
}

/**
 * Full purge of a video (row + file + thumbnail). Delegated to the backend
 * (Spec 06) — never a direct Supabase delete, which would orphan media on disk.
 */
export function deleteVideo(id: string): Promise<void> {
  return api.deleteVideo(id);
}

// ---- categories -------------------------------------------------------------

/** All categories for the current account, ordered by display position. */
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('position', { ascending: true });
  return unwrap(data, error) ?? [];
}

/**
 * Accent palette for category chips. New categories cycle through it by
 * position so each gets a distinct colour instead of all falling back to the
 * DB default (#a78bfa). Kept in sync with the seed accents (cf. §4).
 */
const CATEGORY_PALETTE = ['#ff9966', '#a78bfa', '#5ee2a0', '#5fa8ff', '#ffd166', '#ff7eb3'];

/**
 * Create a category. position is appended after the current max so it lands
 * last in the list (the seed categories occupy 0..5). The colour cycles through
 * CATEGORY_PALETTE by position so each new category is visually distinct.
 */
export async function createCategory(label: string): Promise<Category> {
  const { data: rows, error: posError } = await supabase
    .from('categories')
    .select('position')
    .order('position', { ascending: false })
    .limit(1);
  if (posError) throw new Error(posError.message);
  const nextPosition = (rows?.[0]?.position ?? -1) + 1;
  const color = CATEGORY_PALETTE[nextPosition % CATEGORY_PALETTE.length];

  // categories.user_id is NOT NULL with no default, and RLS enforces
  // `with check (auth.uid() = user_id)`. Unlike the seed categories (set by the
  // handle_new_user trigger), a client insert must carry the owner explicitly —
  // otherwise every insert is rejected and no category is ever created.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Session expirée — reconnecte-toi pour créer une catégorie.');

  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, label, position: nextPosition, color })
    .select()
    .single();
  return unwrap(data, error);
}

/** Rename a category; returns the updated row. */
export async function renameCategory(id: string, label: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update({ label })
    .eq('id', id)
    .select()
    .single();
  return unwrap(data, error);
}

/**
 * Delete a category. The FK is `on delete set null`, so linked videos become
 * uncategorised (category_id = null) rather than being removed (cf. §4).
 */
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- realtime ---------------------------------------------------------------

/**
 * Subscribe to changes on the `videos` table (RLS-scoped) so the library
 * reflects newly ingested videos and status transitions live. Returns an
 * unsubscribe function. The callback fires on any insert/update/delete; callers
 * typically just refetch listVideos().
 */
export function subscribeVideos(cb: () => void): () => void {
  const channel = supabase
    .channel('videos-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'videos' }, () => cb())
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
