// frontend/src/screens/SharedLinksScreen.tsx
// Vue globale « Liens partagés » : tout ce qui est exposé publiquement.
import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import * as api from '../lib/api';
import type { ShareGlobalInfo } from '../lib/types';
import { statusBadge } from '../lib/shareLogic';
import { gradientFromColor } from '../lib/color';

export interface SharedLinksScreenProps {
  onBack: () => void;
}

export function SharedLinksScreen({ onBack }: SharedLinksScreenProps) {
  const [links, setLinks] = useState<ShareGlobalInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setLinks(await api.listAllShares()); } catch { /* */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (id: string) => {
    setLinks((xs) => xs.filter((x) => x.id !== id));
    try { await api.deleteShare(id); } catch { void refresh(); }
  };

  const active = links.filter((l) => l.status === 'active');

  return (
    <div className="view view-enter" style={{ background: 'var(--bg-0)' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
        <button onClick={onBack} aria-label="Retour" style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: 'var(--txt-0)' }}><Icons.back size={18} /></button>
        <h1 style={{ flex: 1, fontSize: 19, fontWeight: 700 }}>Liens partagés</h1>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5ee2a0', background: 'rgba(94,226,160,0.12)', border: '1px solid rgba(94,226,160,0.3)', padding: '4px 9px', borderRadius: 999 }}>{active.length} actifs</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 14px 24px' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center' }}><span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: '50%', border: '2.4px solid var(--hairline-strong)', borderTopColor: 'var(--a-violet)', animation: 'spin 0.7s linear infinite' }} /></div>
        ) : links.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--txt-2)', textAlign: 'center', padding: 30 }}>Aucun lien partagé pour l'instant.</p>
        ) : links.map((l) => {
          const b = statusBadge(l);
          const g = gradientFromColor(l.video?.thumb_color ?? '#a78bfa');
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 10, borderRadius: 16, background: 'var(--bg-2)', border: '1px solid var(--hairline)', marginBottom: 10 }}>
              <div style={{ width: 44, height: 58, borderRadius: 11, flex: '0 0 auto', border: '1px solid var(--hairline)', background: `linear-gradient(150deg, ${g[0]}, ${g[1]})` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 620, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.video?.title ?? 'Réel'}</div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: b.color }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />{b.label}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--txt-2)' }}>· {l.view_count} vues</span>
                </div>
              </div>
              <button onClick={() => revoke(l.id)} aria-label="Révoquer le lien" style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: '#ff8a96', flex: '0 0 auto' }}><Icons.trash size={15} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
