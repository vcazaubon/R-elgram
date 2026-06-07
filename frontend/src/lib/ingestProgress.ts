// ============================================================
// Réelgram — ingest progression helper (Spec 07 T1)
// Pure mapping from the backend ingestion status (+ optional finer step)
// to the values the Import medallion needs: the step index on the 4-stage
// pipeline, a smoothed completion percentage, and the error/done flags.
// Side-effect-free → unit-tested in the Node vitest env.
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §5 (status → step)
// ============================================================
import { STATUS_STEP } from './types';
import type { VideoStatus } from './types';

export interface IngestProgress {
  /** Step index on the pipeline: 0..3, or -1 on error. */
  step: number;
  /** Completion percentage 0..100 driving the medallion ring. */
  percent: number;
  /** True when the job failed. */
  isError: boolean;
  /** True only once the video is fully ready. */
  isDone: boolean;
}

// Per-step completion targets. Each step settles a little before the next
// boundary so the ring keeps moving while a stage is in progress, matching the
// proto's "(step / total) * 100 + lead" feel: 0 → ~12, 1 → ~45, 2 → ~78, 3 → 100.
const STEP_PERCENT = [12, 45, 78, 100] as const;

/**
 * Resolve the medallion state for a given ingestion `status`. An optional
 * finer `step` reported by the backend (`IngestStatus.step`) takes precedence
 * over the coarse status→step mapping so the ring can advance smoothly.
 */
export function progressFor(status: VideoStatus, step?: number): IngestProgress {
  const isError = status === 'error';
  const isDone = status === 'ready';

  if (isError) {
    return { step: -1, percent: 0, isError: true, isDone: false };
  }

  // Prefer the backend-reported step when it sits on the 0..3 track; otherwise
  // fall back to the status mapping.
  const mapped = STATUS_STEP[status];
  const resolved = typeof step === 'number' && step >= 0 && step <= 3 ? step : mapped;
  const clamped = Math.max(0, Math.min(3, resolved));

  return {
    step: clamped,
    percent: STEP_PERCENT[clamped],
    isError: false,
    isDone,
  };
}
