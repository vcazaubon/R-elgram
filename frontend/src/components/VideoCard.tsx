// ============================================================
// Réelgram — Library video card (immersive), migrated to real data
// Ported from design-reference/project/components.jsx.
// Now driven by the real `Video` type: real thumbnail (signed URL) with a
// gradient fallback from `thumb_color`, formatted date/duration/author, and
// the resolved category. Videos whose `status !== 'ready'` show a "…" badge
// and are not clickable until the ingest job completes.
// ============================================================
import type { Video, Category } from '../lib/types';
import { Icons } from './Icons';
import { Thumb } from './Thumb';
import { categoryFor, formatAuthor, formatDate, formatDuration } from '../lib/format';

export interface VideoCardProps {
  video: Video;
  index: number;
  categories: Category[];
  /** Resolved signed thumbnail URL (media-url), if already fetched. */
  thumbUrl?: string | null;
  onOpen: (video: Video) => void;
}

export function VideoCard({ video, index, categories, thumbUrl, onOpen }: VideoCardProps) {
  const cat = categoryFor(video.category_id, categories);
  const ready = video.status === 'ready';

  const body = (
    <div style={{ position: 'relative' }}>
      {/* category glow behind card */}
      <div
        style={{
          position: 'absolute',
          inset: '8px 18px 0',
          borderRadius: 28,
          zIndex: 0,
          background: cat.color,
          filter: 'blur(34px)',
          opacity: 0.18,
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          borderRadius: 26,
          overflow: 'hidden',
          border: '1px solid var(--hairline)',
          boxShadow: 'var(--shadow-card)',
          background: 'var(--bg-2)',
        }}
      >
        <div style={{ position: 'relative', aspectRatio: '16 / 11' }}>
          <Thumb video={{ thumb_color: video.thumb_color, thumbUrl }} radius="0" showPlay={ready} />
          {/* top row: category + source */}
          <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 11px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                color: '#fff',
                background: 'rgba(10,10,12,0.4)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.16)',
              }}
            >
              <span className="cat-dot" style={{ background: cat.color }} />
              {cat.label}
            </span>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(10,10,12,0.4)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.16)',
                color: '#fff',
              }}
            >
              <Icons.insta size={16} />
            </span>
          </div>
          {/* duration (ready) OR processing badge (not ready) */}
          {ready ? (
            <span
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                height: 24,
                padding: '0 9px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                color: '#fff',
                background: 'rgba(10,10,12,0.5)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatDuration(video.duration_seconds)}
            </span>
          ) : (
            <span
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                height: 24,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                color: video.status === 'error' ? '#ff8a96' : '#fff',
                background: 'rgba(10,10,12,0.5)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)',
                letterSpacing: '0.06em',
              }}
            >
              {video.status === 'error' ? 'Erreur' : '…'}
            </span>
          )}
        </div>
        {/* meta strip */}
        <div style={{ padding: '13px 15px 15px' }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.25, color: 'var(--txt-0)', letterSpacing: '-0.01em' }}>{video.title}</div>
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--txt-2)' }}>
            <span>{formatAuthor(video.author)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{formatDate(video.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Not-ready videos are not clickable: render the same card as a static div so
  // the layout/animation is identical but no navigation occurs.
  if (!ready) {
    return (
      <div
        className="rise"
        aria-disabled="true"
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, opacity: 0.78, animationDelay: `${0.04 * index}s` }}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      className="rise"
      onClick={() => onOpen(video)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 0,
        animationDelay: `${0.04 * index}s`,
      }}
    >
      {body}
    </button>
  );
}
