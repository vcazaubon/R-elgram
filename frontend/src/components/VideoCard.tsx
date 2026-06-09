// ============================================================
// Réelgram — Library video card (immersive), migrated to real data
// Ported from design-reference/project/components.jsx.
// Now driven by the real `Video` type: real thumbnail (signed URL) with a
// gradient fallback from `thumb_color`, formatted date/duration/author, and
// the resolved category. Videos whose `status !== 'ready'` show a "…" badge
// and are not clickable until the ingest job completes.
// ============================================================
import { useRef } from 'react';
import type { Video, Category } from '../lib/types';
import { Icons } from './Icons';
import { Thumb } from './Thumb';
import { categoryFor, formatAuthor, formatDate, formatDuration } from '../lib/format';
import { progressFor, dashoffsetFor, STEP_LABELS } from '../lib/ingestProgress';

export interface VideoCardProps {
  video: Video;
  index: number;
  categories: Category[];
  /** Resolved signed thumbnail URL (media-url), if already fetched. */
  thumbUrl?: string | null;
  onOpen: (video: Video) => void;
  /**
   * Long-press handler: lets the user delete a reel straight from the library,
   * without entering the player (which is where the only other delete lives).
   */
  onRequestDelete?: (video: Video) => void;
}

const LONG_PRESS_MS = 500;

export function VideoCard({ video, index, categories, thumbUrl, onOpen, onRequestDelete }: VideoCardProps) {
  const cat = categoryFor(video.category_id, categories);
  const ready = video.status === 'ready';
  const isImage = video.media_type === 'image';
  const slideCount = video.media?.length ?? 0;

  // Long-press → delete. A fired long-press also suppresses the click that iOS
  // synthesises on release, so the player doesn't open at the same time.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const startPress = () => {
    if (!onRequestDelete) return;
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onRequestDelete(video);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const handleClick = () => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return; // the long-press consumed this tap (delete requested)
    }
    onOpen(video);
  };

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
          <Thumb video={{ thumb_color: video.thumb_color, thumbUrl }} radius="0" showPlay={ready && !isImage} />
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
                gap: 5,
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
              {isImage ? (
                <>
                  <Icons.carousel size={13} />
                  {slideCount || 1}
                </>
              ) : (
                formatDuration(video.duration_seconds)
              )}
            </span>
          ) : video.status === 'error' ? (
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
                color: '#ff8a96',
                background: 'rgba(10,10,12,0.5)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)',
                letterSpacing: '0.06em',
              }}
            >
              Erreur
            </span>
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                background: 'rgba(8,8,10,0.4)',
                backdropFilter: 'blur(2px)',
                WebkitBackdropFilter: 'blur(2px)',
              }}
            >
              <svg width="46" height="46" viewBox="0 0 46 46" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="4" />
                <circle
                  cx="23"
                  cy="23"
                  r="19"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 19}
                  strokeDashoffset={dashoffsetFor(progressFor(video.status).percent, 19)}
                  style={{ transition: 'stroke-dashoffset 0.5s var(--ease)' }}
                />
              </svg>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                }}
              >
                {STEP_LABELS[video.status]}
              </span>
            </div>
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

  // Not-ready videos are not clickable (no navigation), but they must still be
  // deletable via long-press — an "error" video can't be opened in the player,
  // so the library is the ONLY place to remove it.
  if (!ready) {
    return (
      <div
        className="rise"
        aria-disabled="true"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, opacity: video.status === 'error' ? 0.78 : 1, animationDelay: `${0.04 * index}s`, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      className="rise"
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 0,
        animationDelay: `${0.04 * index}s`,
        WebkitTouchCallout: 'none',
        // Both are required: React doesn't auto-prefix, and iOS Safari needs the
        // -webkit- form to stop the long-press from triggering text selection.
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {body}
    </button>
  );
}
