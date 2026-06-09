// ============================================================
// Réelgram — Library (search, filters, FAB, cards, count) — real data
// Ported from design-reference/project/screens-main.jsx → LibraryScreen.
// Now driven by the real Video/Category types. Data (videos, categories,
// thumbnail URLs) is loaded in App and passed down; search + category
// filtering are local, exactly like the proto. The header sparkle button is
// replaced by an Account button opening the AccountSheet.
// ============================================================
import { useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import { TabBar, type TabId } from '../components/TabBar';
import { VideoCard } from '../components/VideoCard';
import type { Category, Video } from '../lib/types';
import { formatAuthor } from '../lib/format';

export interface LibraryScreenProps {
  videos: Video[];
  categories: Category[];
  /** videoId → signed thumbnail URL (resolved on demand in App). */
  thumbUrls: Record<string, string>;
  loading: boolean;
  onOpen: (video: Video) => void;
  /** Long-press on a card requests deletion (decoupled from the player). */
  onRequestDelete: (video: Video) => void;
  onAdd: () => void;
  onTab: (tab: TabId) => void;
  tab: TabId;
  onAccount: () => void;
  /** Forwarded to each card: resolve a thumbnail when the card nears view. */
  onThumbVisible?: (id: string) => void;
}

export function LibraryScreen({ videos, categories, thumbUrls, loading, onOpen, onRequestDelete, onAdd, onTab, tab, onAccount, onThumbVisible }: LibraryScreenProps) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [focused, setFocused] = useState(false);

  const filtered = videos.filter((v) => {
    const okCat = filter === 'all' || v.category_id === filter;
    const author = formatAuthor(v.author).toLowerCase();
    const okQ = !q || v.title.toLowerCase().includes(q.toLowerCase()) || author.includes(q.toLowerCase());
    return okCat && okQ;
  });

  const chips = [{ id: 'all', label: 'Tout', color: '' }, ...categories.map((c) => ({ id: c.id, label: c.label, color: c.color }))];

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
            <button onClick={onAccount} aria-label="Compte" style={{
              width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: '0 0 auto',
              background: 'var(--bg-2)', border: '1px solid var(--hairline)', color: 'var(--a-violet)',
            }}><Icons.user size={20} /></button>
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
            {q && <button onClick={() => setQ('')} aria-label="Effacer la recherche" style={{ color: 'var(--txt-2)', display: 'grid', placeItems: 'center' }}><Icons.close size={18} /></button>}
          </div>
        </div>

        {/* category filters */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, overflowX: 'auto', padding: '0 22px 2px', scrollbarWidth: 'none' }} className="hscroll">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={'pill' + (filter === c.id ? ' active' : '')}>
              {c.id !== 'all' && <span className="cat-dot" style={{ background: c.color }} />}
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
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--txt-2)' }}>
              <span style={{ display: 'inline-block', width: 24, height: 24, borderRadius: '50%', border: '2.4px solid var(--hairline-strong)', borderTopColor: 'var(--a-violet)', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--txt-2)' }}>
              <Icons.search size={30} style={{ opacity: 0.5 }} />
              <p style={{ marginTop: 14, fontSize: 14.5 }}>Aucun résultat</p>
            </div>
          ) : filtered.map((v, i) => (
            <VideoCard key={v.id} video={v} index={i} categories={categories} thumbUrl={thumbUrls[v.id]} onOpen={onOpen} onRequestDelete={onRequestDelete} onThumbVisible={onThumbVisible} />
          ))}
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
