// ============================================================
// Réelgram — ingest progression helper tests (Spec 07 T1)
// Pure mapping status → {step, percent, isError, isDone} driving the
// Import medallion. Kept side-effect-free so it runs in the Node vitest env.
// ============================================================
import { describe, it, expect } from 'vitest';
import { progressFor } from './ingestProgress';

describe('progressFor', () => {
  it('maps statuses to step/percent', () => {
    expect(progressFor('analyzing').step).toBe(0);
    expect(progressFor('fetching').step).toBe(1);
    expect(progressFor('thumbnailing').step).toBe(2);
    expect(progressFor('ready').step).toBe(3);
    expect(progressFor('ready').percent).toBe(100);
    expect(progressFor('analyzing').percent).toBeLessThan(100);
    expect(progressFor('analyzing').percent).toBeGreaterThanOrEqual(0);
  });

  it('error has isError', () => {
    expect(progressFor('error').isError).toBe(true);
  });

  it('percent increases monotonically across the pipeline', () => {
    const a = progressFor('analyzing').percent;
    const f = progressFor('fetching').percent;
    const t = progressFor('thumbnailing').percent;
    const r = progressFor('ready').percent;
    expect(a).toBeLessThan(f);
    expect(f).toBeLessThan(t);
    expect(t).toBeLessThan(r);
  });

  it('marks isDone only when ready', () => {
    expect(progressFor('ready').isDone).toBe(true);
    expect(progressFor('analyzing').isDone).toBe(false);
    expect(progressFor('fetching').isDone).toBe(false);
    expect(progressFor('thumbnailing').isDone).toBe(false);
    expect(progressFor('error').isDone).toBe(false);
  });

  it('error is neither done nor on the 0..3 step track', () => {
    expect(progressFor('error').step).toBe(-1);
    expect(progressFor('error').isDone).toBe(false);
  });

  it('a finer backend step overrides the status-derived step', () => {
    // The backend may report a step ahead of the coarse status mapping; the
    // explicit step wins so the medallion can advance smoothly.
    expect(progressFor('fetching', 2).step).toBe(2);
    expect(progressFor('analyzing', 1).percent).toBeGreaterThan(
      progressFor('analyzing', 0).percent,
    );
  });
});
