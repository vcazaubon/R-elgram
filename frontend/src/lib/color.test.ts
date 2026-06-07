// ============================================================
// Réelgram — color helper tests (Spec 05 T2)
// ============================================================
import { describe, it, expect } from 'vitest';
import { gradientFromColor } from './color';

const HEX = /^#[0-9a-f]{6}$/;

describe('gradientFromColor', () => {
  it('returns two valid 6-digit hex colors', () => {
    const [a, b] = gradientFromColor('#a78bfa');
    expect(a).toMatch(HEX);
    expect(b).toMatch(HEX);
  });

  it('returns a pair (two distinct stops for a non-black input)', () => {
    const [a, b] = gradientFromColor('#a78bfa');
    expect(a).not.toBe(b);
  });

  it('accepts shorthand #rgb', () => {
    const [a, b] = gradientFromColor('#abc');
    expect(a).toMatch(HEX);
    expect(b).toMatch(HEX);
  });

  it('accepts a hex without a leading #', () => {
    const [a, b] = gradientFromColor('5ee2a0');
    expect(a).toMatch(HEX);
    expect(b).toMatch(HEX);
  });

  it('falls back to a valid gradient for garbage input', () => {
    const [a, b] = gradientFromColor('not-a-color');
    expect(a).toMatch(HEX);
    expect(b).toMatch(HEX);
  });

  it('clamps without overflow for bright inputs', () => {
    const [, b] = gradientFromColor('#ffffff');
    expect(b).toBe('#ffffff');
  });
});
