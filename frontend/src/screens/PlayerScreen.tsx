// ============================================================
// Réelgram — Cinematic Player (9:16 stage, scrub, action row, sheets)
// Ported from design-reference/project/screens-player.jsx, migrated to real
// data: a real <video src=stream_url playsInline> replaces the placeholder,
// custom controls (play/pause + scrub) are bound to currentTime/duration, and
// the ambient backdrop/glow is derived from `thumb_color`. Bottom sheets persist
// rename / recategorise via updateVideo, and delete via deleteVideo (then back).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icons, type IconProps } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import type { Category, Video } from '../lib/types';
import { categoryFor, formatAuthor, formatDate, formatDuration } from '../lib/format';
import { gradientFromColor } from '../lib/color';

export interface PlayerScreenProps {
  video: Video;
  categories: Category[];
  /** Signed stream URL (media-url); null while resolving / on failure. */
  streamUrl: string | null;
  onBack: () => void;
  /** Persist a metadata change (title / category) on the current video. */
  onUpdate: (fields: { title?: string; category_id?: string | null }) => void;
  onDelete: (video: Video) => void;
}

type SheetType = 'rename' | 'category' | 'delete' | 'more';

const fmtTime = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PlayerScreen({ video, categories, streamUrl, onBack, onUpdate, onDelete }: PlayerScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video.duration_seconds ?? 0);
  const [sheet, setSheet] = useState<SheetType | null>(null);
  const [title, setTitle] = useState(video.title);

  const cat = categoryFor(video.category_id, categories);
  // Ambient glow color: the brighter stop of the gradient derived from the
  // stored dominant color (replaces the proto's video.g[1]).
  const glow = gradientFromColor(video.thumb_color)[1];
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  // Keep the local title in sync if the video prop changes (e.g. after update).
  useEffect(() => { setTitle(video.title); }, [video.title]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => { /* autoplay/gesture restrictions — ignore */ });
    } else {
      el.pause();
    }
  };

  const seekTo = (frac: number) => {
    const el = videoRef.current;
    const f = Math.max(0, Math.min(1, frac));
    if (el && duration > 0) {
      el.currentTime = f * duration;
    }
    setCurrent(f * duration);
  };

  return (
    <div className="view modal-enter" style={{ background: '#060608' }}>
      {/* cinematic ambient backdrop from the dominant thumbnail color */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(90% 60% at 50% 30%, ${glow}55, transparent 65%)`, filter: 'blur(30px)', opacity: 0.7 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.4), transparent 30%, transparent 70%, rgba(0,0,0,0.6))' }} />

      <StatusBar />
      {/* top bar */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 18px' }}>
        <button onClick={onBack} aria-label="Retour" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)', color: '#fff' }}>
          <Icons.back size={20} />
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 560, color: 'rgba(255,255,255,0.8)' }}>
          <span className="cat-dot" style={{ background: cat.color }} />{cat.label}
        </span>
        <button onClick={() => setSheet('more')} aria-label="Plus d'options" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)', color: '#fff' }}>
          <Icons.more size={20} />
        </button>
      </div>

      {/* video stage — minHeight:0 lets it shrink (flex items don't shrink below
          their content by default); the card is sized by HEIGHT so it scales
          down to fit instead of pushing the controls off-screen (PWA standalone,
          where the safe-area insets eat extra vertical space). */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 20px' }}>
        <div style={{ position: 'relative', height: '100%', width: 'auto', maxWidth: '100%', aspectRatio: '9 / 16', borderRadius: 28, overflow: 'hidden', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.9), 0 0 60px -20px ' + glow, border: '1px solid rgba(255,255,255,0.12)', background: `linear-gradient(150deg, ${gradientFromColor(video.thumb_color)[0]}, ${glow})` }}
          onClick={togglePlay}>
          {streamUrl ? (
            <video
              ref={videoRef}
              src={streamUrl}
              playsInline
              autoPlay
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
              onEnded={() => setPlaying(false)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2.6px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
            </div>
          )}
          {/* play/pause overlay */}
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: playing ? 'transparent' : 'rgba(0,0,0,0.25)', transition: 'background 0.3s', pointerEvents: 'none' }}>
            {!playing && streamUrl && (
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(10,10,12,0.42)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center', animation: 'rise 0.25s var(--ease) both' }}>
                <Icons.play size={30} style={{ marginLeft: 3, color: '#fff' }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* controls */}
      <div style={{ position: 'relative', zIndex: 2, padding: '0 24px calc(env(safe-area-inset-bottom,0px) + 26px)' }}>
        {/* scrub bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums', width: 30 }}>{fmtTime(current)}</span>
          <div onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); }}
            style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.16)', position: 'relative', cursor: 'pointer' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, borderRadius: 999, background: 'var(--grad-accent)' }} />
            <div style={{ position: 'absolute', left: `${progress * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 13, height: 13, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
          </div>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums', width: 30 }}>{duration > 0 ? fmtTime(duration) : formatDuration(video.duration_seconds)}</span>
        </div>

        {/* title */}
        <h1 style={{ marginTop: 20, fontSize: 21, fontWeight: 680, letterSpacing: '-0.02em', lineHeight: 1.25, color: '#fff' }}>{title}</h1>
        <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          <Icons.insta size={15} /> {formatAuthor(video.author)} <span style={{ opacity: 0.4 }}>·</span> {formatDate(video.created_at)}
        </div>

        {/* minimal action row */}
        <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
          <button onClick={togglePlay} style={{ flex: 1, height: 54, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontSize: 15.5, fontWeight: 640, color: '#120a14', background: 'var(--grad-accent)' }}>
            {playing ? <><Icons.pause size={20} /> Pause</> : <><Icons.play size={19} /> Lire</>}
          </button>
          <ActionBtn icon={Icons.edit} onClick={() => setSheet('rename')} label="Renommer" />
          <ActionBtn icon={Icons.tag} onClick={() => setSheet('category')} label="Changer de catégorie" />
          <ActionBtn icon={Icons.trash} onClick={() => setSheet('delete')} danger label="Supprimer" />
        </div>
      </div>

      {/* bottom sheets */}
      {sheet && <PlayerSheet
        type={sheet} title={title} categories={categories} currentCategoryId={video.category_id}
        onClose={() => setSheet(null)}
        onRename={(t) => { const next = t.trim(); if (next) { setTitle(next); onUpdate({ title: next }); } setSheet(null); }}
        onCategory={(id) => { onUpdate({ category_id: id }); setSheet(null); }}
        onDelete={() => { setSheet(null); onDelete(video); }}
      />}
    </div>
  );
}

interface ActionBtnProps {
  icon: (p: IconProps) => ReactNode;
  onClick: () => void;
  danger?: boolean;
  label?: string;
}

function ActionBtn({ icon: Icon, onClick, danger, label }: ActionBtnProps) {
  return (
    <button onClick={onClick} aria-label={label ?? 'Action'} style={{ width: 54, height: 54, borderRadius: 16, display: 'grid', placeItems: 'center',
      background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)',
      color: danger ? '#ff8a96' : '#fff' }}>
      <Icon size={21} />
    </button>
  );
}

interface PlayerSheetProps {
  type: SheetType;
  title: string;
  categories: Category[];
  currentCategoryId: string | null;
  onClose: () => void;
  onRename: (title: string) => void;
  onCategory: (id: string | null) => void;
  onDelete: () => void;
}

function PlayerSheet({ type, title, categories, currentCategoryId, onClose, onRename, onCategory, onDelete }: PlayerSheetProps) {
  const [draft, setDraft] = useState(title);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', animation: 'fadeBg 0.25s ease both' }}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)', borderBottom: 'none',
        padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)', animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />

        {type === 'more' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SheetRow icon={Icons.edit} label="Renommer" onClick={() => {}} disabled />
            <p style={{ fontSize: 13, color: 'var(--txt-2)', textAlign: 'center', padding: 20 }}>Utilise les actions ci-dessous.</p>
          </div>
        )}

        {type === 'rename' && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 680, marginBottom: 16 }}>Renommer</h3>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onRename(draft)}
              style={{ width: '100%', height: 54, padding: '0 16px', borderRadius: 15, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', color: 'var(--txt-0)', fontSize: 16, outline: 'none' }} />
            <button className="btn-primary" style={{ marginTop: 18 }} onClick={() => onRename(draft)}><Icons.check size={19} /> Enregistrer</button>
          </div>
        )}

        {type === 'category' && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 680, marginBottom: 16 }}>Changer de catégorie</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categories.map((c) => (
                <button key={c.id} onClick={() => onCategory(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14,
                  background: c.id === currentCategoryId ? 'var(--bg-3)' : 'transparent', border: '1px solid ' + (c.id === currentCategoryId ? 'var(--hairline-strong)' : 'transparent') }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: c.color, boxShadow: `0 0 12px -1px ${c.color}` }} />
                  <span style={{ fontSize: 15.5, fontWeight: 540, color: 'var(--txt-0)' }}>{c.label}</span>
                  {c.id === currentCategoryId && <span style={{ marginLeft: 'auto', color: 'var(--a-violet)' }}><Icons.check size={19} /></span>}
                </button>
              ))}
              {/* "Sans catégorie" option (category_id = null) */}
              <button onClick={() => onCategory(null)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14,
                background: currentCategoryId === null ? 'var(--bg-3)' : 'transparent', border: '1px solid ' + (currentCategoryId === null ? 'var(--hairline-strong)' : 'transparent') }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--txt-3)' }} />
                <span style={{ fontSize: 15.5, fontWeight: 540, color: 'var(--txt-0)' }}>Sans catégorie</span>
                {currentCategoryId === null && <span style={{ marginLeft: 'auto', color: 'var(--a-violet)' }}><Icons.check size={19} /></span>}
              </button>
            </div>
          </div>
        )}

        {type === 'delete' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,93,108,0.12)', display: 'grid', placeItems: 'center', margin: '4px auto 16px', color: '#ff8a96' }}>
              <Icons.trash size={26} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 680 }}>Supprimer cette vidéo ?</h3>
            <p style={{ fontSize: 14, color: 'var(--txt-1)', marginTop: 8, lineHeight: 1.5 }}>Elle sera retirée de ta bibliothèque. Cette action est définitive.</p>
            <button onClick={onDelete} style={{ marginTop: 22, width: '100%', height: 54, borderRadius: 16, fontSize: 16, fontWeight: 640, color: '#fff', background: '#e8475a' }}>Supprimer</button>
            <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onClose}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SheetRowProps {
  icon: (p: IconProps) => ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function SheetRow({ icon: Icon, label, onClick, disabled }: SheetRowProps) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14, opacity: disabled ? 0.4 : 1 }}>
      <Icon size={20} style={{ color: 'var(--txt-1)' }} /><span style={{ fontSize: 15.5, color: 'var(--txt-0)' }}>{label}</span>
    </button>
  );
}
