// Index de slide actif déduit de la position de scroll horizontal (scroll-snap).
// Pur et borné → testable sans DOM.
export function activeIndexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (slideWidth <= 0 || count <= 0) return 0;
  const idx = Math.round(scrollLeft / slideWidth);
  return Math.max(0, Math.min(count - 1, idx));
}
