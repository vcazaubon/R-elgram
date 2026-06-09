// ============================================================
// Réelgram — useInView (IntersectionObserver, sticky)
// Returns true once the observed element first intersects the viewport (plus
// rootMargin), then stays true and disconnects — a card needs to ask for its
// thumbnail once, not toggle. Degrades to immediately-true when
// IntersectionObserver is unavailable (never leaves a blank card).
// cf. docs/superpowers/specs/2026-06-08-library-lazy-display-design.md §2
// ============================================================
import { useEffect, useState } from 'react';

export function useInView(
  ref: { current: Element | null },
  options: { rootMargin?: string } = {},
): boolean {
  const [inView, setInView] = useState(false);
  const rootMargin = options.rootMargin ?? '0px';

  useEffect(() => {
    if (inView) return; // sticky: already seen — nothing left to observe
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true); // no API → load eagerly rather than show nothing
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, inView, rootMargin]);

  return inView;
}
