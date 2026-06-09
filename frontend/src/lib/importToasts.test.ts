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
    media_type: 'video' as const,
    media: null,
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

  it('ignores a reel already terminal in prev (idempotent re-delivery)', () => {
    expect(detectCompletions([vid('a', 'ready')], [vid('a', 'ready')])).toEqual([]);
    expect(detectCompletions([vid('b', 'error')], [vid('b', 'error')])).toEqual([]);
  });
});
