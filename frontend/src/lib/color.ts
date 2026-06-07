// ============================================================
// Réelgram — color helpers (Spec 05)
// The mockup uses a 2-stop gradient per thumbnail. With real videos the
// dominant color is stored as `thumb_color` (a single hex); this derives a
// plausible gradient pair from it for the ambient glow / thumbnail fallback
// when no real thumbnail image is available.
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §4
// ============================================================

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Parse #rgb / #rrggbb (case-insensitive, leading # optional). */
function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    // Fallback to the brand accent so callers always get a usable gradient.
    return { r: 0xa7, g: 0x8b, b: 0xfa };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Scale each channel toward black (factor<1) or white-ish (factor>1). */
function scale({ r, g, b }: Rgb, factor: number): Rgb {
  return { r: r * factor, g: g * factor, b: b * factor };
}

/**
 * Derive a 2-stop gradient `[from, to]` from a single dominant hex.
 * `from` is a deeper shade and `to` a brighter one, giving a soft glow that
 * matches the cinematic look of the mockup gradients.
 */
export function gradientFromColor(hex: string): [string, string] {
  const base = parseHex(hex);
  const dark = scale(base, 0.55);
  const bright = scale(base, 1.25);
  return [toHex(dark), toHex(bright)];
}
