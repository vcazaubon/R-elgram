// ============================================================
// Réelgram — Library (search, filters, FAB, cards, count)
// Ported from design-reference/project/screens-main.jsx → LibraryScreen.
// ============================================================
import { useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import { TabBar, type TabId } from '../components/TabBar';
import { VideoCard } from '../components/VideoCard';
import { CATEGORIES, catById, type MockVideo } from '../lib/mock';

export interface LibraryScreenProps {
  videos: MockVideo[];
  onOpen: (video: MockVideo) => void;
  onAdd: () => void;
  onTab: (tab: TabId) => void;
  tab: TabId;
  onDirection: () => void;
}

export function LibraryScreen({ videos, onOpen, onAdd, onTab, tab, onDirection }: LibraryScreenProps) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [focused, setFocused] = useState(false);

  const filtered = videos.filter((v) => {
    const okCat = filter === 'all' || v.cat === filter;
    const okQ = !q || v.title.toLowerCase().includes(q.toLowerCase()) || v.auteur.toLowerCase().includes(q.toLowerCase());
    return okCat && okQ;
  });

  const chips = [{ id: 'all', label: 'Tout' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110 }}>
        {/* header */}
        <div style={{ padding: '8px 22px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>Réelgram</h1>
              <p style={{ marginTop: 7, fontSize: 14.5, color: 'var(--txt-1)', letterSpacing: '-0.01em' }}>Tes vidéos sauvegardées, au même endroit.</p>
            </div>
            <button onClick={onDirection} aria-label="Design direction" style={{
              width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: '0 0 auto',
              background: 'var(--bg-2)', border: '1px solid var(--hairline)', color: 'var(--a-violet)',
            }}><Icons.sparkle size={20} /></button>
          </div>
        </div>

        {/* search */}
        <div style={{ padding: '16px 22px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 14px',
            borderRadius: 15, background: 'var(--bg-2)',
            border: `1px solid ${focused ? 'var(--hairline-strong)' : 'var(--hairline)'}`,
            transition: 'border-color 0.25s var(--ease)',
            boxShadow: focused ? '0 0 0 4px rgba(167,139,250,0.10)' : 'none',
          }}>
            <Icons.search size={19} style={{ color: 'var(--txt-2)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder="Rechercher dans ta bibliothèque"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 15 }} />
            {q && <button onClick={() => setQ('')} style={{ color: 'var(--txt-2)', display: 'grid', placeItems: 'center' }}><Icons.close size={18} /></button>}
          </div>
        </div>

        {/* category filters */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, overflowX: 'auto', padding: '0 22px 2px', scrollbarWidth: 'none' }} className="hscroll">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={'pill' + (filter === c.id ? ' active' : '')}>
              {c.id !== 'all' && <span className="cat-dot" style={{ background: catById(c.id).hex }} />}
              {c.label}
            </button>
          ))}
        </div>

        {/* count */}
        <div style={{ padding: '18px 22px 8px', fontSize: 12.5, fontWeight: 600, color: 'var(--txt-2)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          {filtered.length} vidéo{filtered.length > 1 ? 's' : ''}
        </div>

        {/* cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '0 22px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--txt-2)' }}>
              <Icons.search size={30} style={{ opacity: 0.5 }} />
              <p style={{ marginTop: 14, fontSize: 14.5 }}>Aucun résultat</p>
            </div>
          ) : filtered.map((v, i) => <VideoCard key={v.id} video={v} index={i} onOpen={onOpen} />)}
        </div>
      </div>

      {/* FAB */}
      <button onClick={onAdd} style={{
        position: 'absolute', right: 22, bottom: 96, zIndex: 25,
        height: 56, padding: '0 22px 0 18px', borderRadius: 999,
        display: 'flex', alignItems: 'center', gap: 9, color: '#120a14', fontWeight: 680, fontSize: 15.5,
        background: 'var(--grad-accent)', animation: 'glowPulse 3.4s ease-in-out infinite',
      }}>
        <Icons.plus size={21} /> Ajouter un lien
      </button>

      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}
