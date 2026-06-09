// ============================================================
// Réelgram — Bottom sheet d'actions média (renommer / catégorie / supprimer)
// Partagé par PlayerScreen (vidéo) et GalleryScreen (images). Comportement
// identique à l'ancien PlayerSheet ; simple extraction pour réutilisation (DRY).
// ============================================================
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icons, type IconProps } from '../components/Icons';
import type { Category } from '../lib/types';

export type SheetType = 'rename' | 'category' | 'delete' | 'more';

export interface ActionBtnProps {
  icon: (p: IconProps) => ReactNode;
  onClick: () => void;
  danger?: boolean;
  label?: string;
}

export function ActionBtn({ icon: Icon, onClick, danger, label }: ActionBtnProps) {
  return (
    <button onClick={onClick} aria-label={label ?? 'Action'} style={{ width: 54, height: 54, borderRadius: 16, display: 'grid', placeItems: 'center',
      background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)',
      color: danger ? '#ff8a96' : '#fff' }}>
      <Icon size={21} />
    </button>
  );
}

export interface MediaActionSheetProps {
  type: SheetType;
  title: string;
  categories: Category[];
  currentCategoryId: string | null;
  onClose: () => void;
  onRename: (title: string) => void;
  onCategory: (id: string | null) => void;
  onDelete: () => void;
}

export function MediaActionSheet({ type, title, categories, currentCategoryId, onClose, onRename, onCategory, onDelete }: MediaActionSheetProps) {
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
            <h3 style={{ fontSize: 18, fontWeight: 680 }}>Supprimer cette publication ?</h3>
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
