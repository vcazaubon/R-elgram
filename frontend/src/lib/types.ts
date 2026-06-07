// ============================================================
// Réelgram — types partagés (reflètent le data model + l'API)
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §4 et §5
// ============================================================

export type VideoStatus =
  | 'analyzing'
  | 'fetching'
  | 'thumbnailing'
  | 'ready'
  | 'error';

export interface Category {
  id: string;
  label: string;
  color: string;
  position: number;
}

export interface Video {
  id: string;
  category_id: string | null;
  source_url: string;
  title: string;
  author: string | null;
  duration_seconds: number | null;
  thumb_color: string;
  status: VideoStatus;
  error: string | null;
  created_at: string;
}

export interface IngestStatus {
  status: VideoStatus;
  step: number; // 0..3
  error: string | null;
}

export interface ApiToken {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface MediaUrls {
  stream_url: string;
  thumb_url: string;
}

// status -> step (cf. design maître §5)
export const STATUS_STEP: Record<VideoStatus, number> = {
  analyzing: 0,
  fetching: 1,
  thumbnailing: 2,
  ready: 3,
  error: -1,
};
