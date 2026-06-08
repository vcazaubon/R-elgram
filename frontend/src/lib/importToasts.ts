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
