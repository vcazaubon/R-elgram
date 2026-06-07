// ============================================================
// Réelgram — Thumbnail (real <img> when available, gradient fallback)
// Ported from design-reference/project/components.jsx, migrated to real data.
// Real videos store a dominant `thumb_color`; a signed `thumbUrl` may be
// resolved on demand (media-url). When the image is present we render it;
// otherwise we fall back to the 2-stop gradient derived from `thumb_color`
// (gradientFromColor) — pixel-identical to the proto's placeholder look.
// The import preview / design-direction still pass a raw gradient pair.
// ============================================================
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Icons } from './Icons';
import { gradientFromColor } from '../lib/color';

/**
 * Thumb accepts either a raw gradient pair (`{ g }` — import preview / design
 * direction) or a real video shape (`{ thumb_color, thumbUrl? }`). When a
 * thumbUrl is present and loads, the real image is shown over the gradient.
 */
export type ThumbVideo =
  | { g: [string, string]; thumb_color?: undefined; thumbUrl?: undefined }
  | { thumb_color: string; thumbUrl?: string | null; g?: undefined };

export interface ThumbProps {
  video: ThumbVideo;
  radius?: string;
  showPlay?: boolean;
  scrim?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function gradientOf(video: ThumbVideo): [string, string] {
  if (video.g) return video.g;
  return gradientFromColor(video.thumb_color);
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
  const [g0, g1] = gradientOf(video);
  const thumbUrl = video.thumbUrl ?? null;
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!thumbUrl && !imgFailed;

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
      {/* real thumbnail image (signed URL), shown over the gradient fallback */}
      {showImg && (
        <img
          src={thumbUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {/* diagonal stripe texture (gradient-only; hidden under a real image) */}
      {!showImg && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.5,
            backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 16px)',
          }}
        />
      )}
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
