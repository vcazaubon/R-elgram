import { describe, it, expect } from 'vitest';
import { activeIndexFromScroll } from './galleryLogic';

describe('activeIndexFromScroll', () => {
  it('maps scroll position to the nearest slide', () => {
    expect(activeIndexFromScroll(0, 320, 3)).toBe(0);
    expect(activeIndexFromScroll(170, 320, 3)).toBe(1);  // > moitié → arrondi au suivant
    expect(activeIndexFromScroll(320, 320, 3)).toBe(1);
    expect(activeIndexFromScroll(640, 320, 3)).toBe(2);
  });

  it('clamps within [0, count-1] and tolerates degenerate inputs', () => {
    expect(activeIndexFromScroll(99999, 320, 3)).toBe(2);
    expect(activeIndexFromScroll(-50, 320, 3)).toBe(0);
    expect(activeIndexFromScroll(100, 0, 3)).toBe(0);
    expect(activeIndexFromScroll(100, 320, 0)).toBe(0);
  });
});
