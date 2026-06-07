// ============================================================
// Réelgram — Placeholder thumbnail (gradient + diagonal stripes + play glyph)
// Ported from design-reference/project/components.jsx.
// ============================================================
import type { CSSProperties, ReactNode } from 'react';
import type { MockVideo } from '../lib/mock';
import { Icons } from './Icons';

export interface ThumbProps {
  video: MockVideo;
  radius?: string;
  showPlay?: boolean;
  scrim?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Thumb({
  video,
  radius = 'var(--r-lg)',
  showPlay = true,
  scrim = true,
  children,
  className = '',
  style = {},
}: ThumbProps) {
  const [g0, g1] = video.g;
  return (
    <div
      className={'thumb ' + className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: radius,
        overflow: 'hidden',
        background: `linear-gradient(150deg, ${g0}, ${g1})`,
        ...style,
      }}
    >
      {/* diagonal stripe texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.5,
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 16px)',
        }}
      />
      {/* soft vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,0.16), transparent 55%)' }} />
      {scrim && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.55) 100%)' }} />}
      {showPlay && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              background: 'rgba(10,10,12,0.42)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.22)',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6)',
            }}
          >
            <Icons.play size={22} style={{ marginLeft: 2, color: '#fff' }} />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
