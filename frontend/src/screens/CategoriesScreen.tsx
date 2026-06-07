// ============================================================
// Réelgram — Categories (inline add / rename / delete on local state)
// Ported from design-reference/project/screens-main.jsx → CategoriesScreen.
// ============================================================
import { useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import { TabBar, type TabId } from '../components/TabBar';
import type { MockCategory, MockVideo } from '../lib/mock';

export interface CategoriesScreenProps {
  videos: MockVideo[];
  categories: MockCategory[];
  onTab: (tab: TabId) => void;
  tab: TabId;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onAdd: (label: string) => void;
}

export function CategoriesScreen({ videos, categories, onTab, tab, onRename, onDelete, onAdd }: CategoriesScreenProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const count = (id: string) => videos.filter((v) => v.cat === id).length;

  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110 }}>
        <div style={{ padding: '8px 22px 4px' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em' }}>Catégories</h1>
          <p style={{ marginTop: 7, fontSize: 14.5, color: 'var(--txt-1)' }}>Organise ton vault comme tu veux.</p>
        </div>

        <div style={{ padding: '20px 22px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {categories.map((c, i) => (
            <div key={c.id} className="rise" style={{ animationDelay: `${0.04 * i}s`,
              display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 18,
              background: 'var(--bg-1)', border: '1px solid var(--hairline)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.hex, boxShadow: `0 0 14px -1px ${c.hex}`, flex: '0 0 auto' }} />
              {editing === c.id ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { onRename(c.id, draft); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { onRename(c.id, draft); setEditing(null); } }}
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 16, fontWeight: 560 }} />
              ) : (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 560, color: 'var(--txt-0)' }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--txt-2)', marginTop: 2 }}>{count(c.id)} vidéo{count(c.id) > 1 ? 's' : ''}</div>
                </div>
              )}
              <button onClick={() => { setEditing(c.id); setDraft(c.label); }} aria-label="Renommer la catégorie" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: 'var(--txt-1)', background: 'var(--bg-3)', border: '1px solid var(--hairline)' }}><Icons.edit size={17} /></button>
              <button onClick={() => onDelete(c.id)} aria-label="Supprimer la catégorie" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: 'var(--txt-2)', background: 'var(--bg-3)', border: '1px solid var(--hairline)' }}><Icons.trash size={17} /></button>
            </div>
          ))}

          {adding ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 18, background: 'var(--bg-1)', border: '1px solid var(--hairline-strong)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--grad-accent)', flex: '0 0 auto' }} />
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la catégorie"
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { onAdd(newName.trim()); setNewName(''); setAdding(false); } }}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 16 }} />
              <button onClick={() => { if (newName.trim()) onAdd(newName.trim()); setNewName(''); setAdding(false); }} style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: '#0a0a0c', background: 'var(--grad-accent)' }}><Icons.check size={18} /></button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '15px 16px', borderRadius: 18, marginTop: 2,
              background: 'transparent', border: '1.5px dashed var(--hairline-strong)', color: 'var(--txt-1)', fontSize: 15, fontWeight: 560,
            }}>
              <span style={{ width: 26, height: 26, borderRadius: 9, background: 'var(--bg-3)', display: 'grid', placeItems: 'center' }}><Icons.plus size={17} /></span>
              Ajouter une catégorie
            </button>
          )}
        </div>
      </div>
      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}
