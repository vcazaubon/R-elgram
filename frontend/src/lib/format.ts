// ============================================================
// Réelgram — display formatting helpers (Spec 05)
// Real videos carry `created_at` (ISO timestamp) and `duration_seconds`
// (number | null). The mock proto used pre-baked `date`/`dur` strings; these
// helpers reproduce that look from the real fields so the UI stays identical.
// ============================================================
import type { Category } from './types';

const UNCATEGORISED_LABEL = 'Sans catégorie';

/**
 * Human, French, relative-ish date matching the proto strings
 * ("Aujourd'hui", "Hier", "2 j", "3 j", "1 sem", then a short date).
 */
export function formatDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  // Compare at day granularity (local time) so "today" / "yesterday" are stable.
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;
  const days = Math.floor((startOf(now) - startOf(then)) / dayMs);

  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `${days} j`;
  if (days < 31) {
    const weeks = Math.floor(days / 7);
    return `${weeks} sem`;
  }
  return then.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Seconds → "m:ss" (proto used "0:48", "1:12"). null/invalid → "0:00". */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Author handle with a graceful fallback when the source had none. */
export function formatAuthor(author: string | null | undefined): string {
  return author && author.trim() ? author : 'Instagram';
}

/** Resolve a category by id; null id → the "uncategorised" pseudo-category. */
export function categoryFor(
  id: string | null,
  categories: Category[],
): { label: string; color: string } {
  if (id) {
    const found = categories.find((c) => c.id === id);
    if (found) return { label: found.label, color: found.color };
  }
  return { label: UNCATEGORISED_LABEL, color: 'var(--txt-3)' };
}
