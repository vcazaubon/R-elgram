// ============================================================
// Réelgram — Visualiseur d'un post image (carrousel swipe, image entière)
// Reprend le décor du lecteur (barre du haut, fond flou ambiant, rangée
// d'actions) mais remplace l'étage vidéo par une piste swipe horizontale
// (scroll-snap natif) : chaque photo est montrée ENTIÈRE (contain) sur fond
// flou. Pastilles + compteur. Pas de scrub/play.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import type { Category, Video } from '../lib/types';
import { categoryFor, formatAuthor, formatDate } from '../lib/format';
import { gradientFromColor } from '../lib/color';
import { MediaActionSheet, ActionBtn, type SheetType } from './MediaActionSheet';
import { activeIndexFromScroll } from './galleryLogic';

export interface GalleryScreenProps {
  video: Video;
  categories: Category[];
  /** URLs signées des slides (ordre = index) ; null pendant la résolution. */
  slides: string[] | null;
  onBack: () => void;
  onUpdate: (fields: { title?: string; category_id?: string | null }) => void;
  onDelete: (video: Video) => void;
}

export function GalleryScreen({ video, categories, slides, onBack, onUpdate, onDelete }: GalleryScreenProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<SheetType | null>(null);
  const [title, setTitle] = useState(video.title);

  const cat = categoryFor(video.category_id, categories);
  const glow = gradientFromColor(video.thumb_color)[1];
  const count = slides?.length ?? video.media?.length ?? 0;

  useEffect(() => { setTitle(video.title); }, [video.title]);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setActive(activeIndexFromScroll(el.scrollLeft, el.clientWidth, count));
  };

  return (
    <div className="view modal-enter" style={{ background: '#060608' }}>
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

      {/* stage : piste swipe horizontale (scroll-snap) */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
        {slides ? (
          <div
            ref={trackRef}
            onScroll={onScroll}
            style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
          >
            {slides.map((src, i) => (
              <div key={i} style={{ position: 'relative', flex: '0 0 100%', width: '100%', height: '100%', scrollSnapAlign: 'center', display: 'grid', placeItems: 'center' }}>
                {/* fond flou ambiant = la photo elle-même, agrandie/floutée */}
                <img src={src} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.5)', transform: 'scale(1.2)' }} />
                {/* la photo entière (contain), jamais recadrée */}
                <img src={src} alt={`Photo ${i + 1} sur ${count}`} style={{ position: 'relative', maxWidth: '92%', maxHeight: '100%', objectFit: 'contain', borderRadius: 18, boxShadow: '0 30px 70px -25px rgba(0,0,0,0.9)' }} />
              </div>
            ))}
          </div>
        ) : (
          <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2.6px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
        )}
      </div>

      {/* pastilles + compteur */}
      {count > 1 && (
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '4px 0 2px' }}>
          {Array.from({ length: count }).map((_, i) => (
            <span key={i} style={{ width: i === active ? 7 : 5, height: i === active ? 7 : 5, borderRadius: '50%', background: i === active ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all 0.2s' }} />
          ))}
        </div>
      )}

      {/* infos + actions */}
      <div style={{ position: 'relative', zIndex: 2, padding: '6px 24px calc(env(safe-area-inset-bottom,0px) + 26px)' }}>
        <h1 style={{ marginTop: 12, fontSize: 21, fontWeight: 680, letterSpacing: '-0.02em', lineHeight: 1.25, color: '#fff' }}>{title}</h1>
        <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          <Icons.insta size={15} /> {formatAuthor(video.author)} <span style={{ opacity: 0.4 }}>·</span> {formatDate(video.created_at)}
          {count > 1 && (<><span style={{ opacity: 0.4 }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icons.carousel size={14} /> {active + 1}/{count}</span></>)}
        </div>

        <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
          <ActionBtn icon={Icons.edit} onClick={() => setSheet('rename')} label="Renommer" />
          <ActionBtn icon={Icons.tag} onClick={() => setSheet('category')} label="Changer de catégorie" />
          <ActionBtn icon={Icons.trash} onClick={() => setSheet('delete')} danger label="Supprimer" />
        </div>
      </div>

      {sheet && <MediaActionSheet
        type={sheet} title={title} categories={categories} currentCategoryId={video.category_id}
        onClose={() => setSheet(null)}
        onRename={(t) => { const next = t.trim(); if (next) { setTitle(next); onUpdate({ title: next }); } setSheet(null); }}
        onCategory={(id) => { onUpdate({ category_id: id }); setSheet(null); }}
        onDelete={() => { setSheet(null); onDelete(video); }}
      />}
    </div>
  );
}
