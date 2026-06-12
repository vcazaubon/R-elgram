// frontend/src/screens/ShareSheet.tsx
// Bottom sheet de partage (même chrome que MediaActionSheet) : liste des liens
// du réel + création (configurer → lien prêt). navigator.share avec repli copie.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icons } from '../components/Icons';
import * as api from '../lib/api';
import type { ShareInfo, ShareExpiresIn } from '../lib/types';
import { EXPIRY_OPTIONS, DEFAULT_EXPIRY, statusBadge, formatExpiry } from '../lib/shareLogic';

export interface ShareSheetProps {
  videoId: string;
  videoTitle: string;
  onClose: () => void;
}

type Phase = { kind: 'list' } | { kind: 'configure' } | { kind: 'ready'; share: ShareInfo };

const sheetWrap: CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 45, display: 'flex', flexDirection: 'column',
  justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
  animation: 'fadeBg 0.25s ease both',
};
const sheetBody: CSSProperties = {
  background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)',
  borderBottom: 'none', padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)',
  animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)',
  maxHeight: '88%', overflowY: 'auto',
};

export function ShareSheet({ videoId, videoTitle, onClose }: ShareSheetProps) {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'list' });
  const [expiry, setExpiry] = useState<ShareExpiresIn>(DEFAULT_EXPIRY);
  const [withPassword, setWithPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (initial = false) => {
    setLoading(true);
    try {
      const list = await api.listVideoShares(videoId);
      setShares(list);
      // Auto-ouvre la configuration UNIQUEMENT au chargement initial (réel sans
      // lien) — jamais après une révocation qui viderait la liste.
      if (initial && list.length === 0) setPhase({ kind: 'configure' });
    } catch { /* garde la dernière liste connue */ }
    finally { setLoading(false); }
  }, [videoId]);

  useEffect(() => { void refresh(true); }, [refresh]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const created = await api.createShare(videoId, {
        expires_in: expiry, password: withPassword && pin ? pin : null,
      });
      const info: ShareInfo = {
        id: created.id, slug: created.slug, url: created.url, status: 'active',
        expires_at: created.expires_at, has_password: created.has_password,
        view_count: 0, created_at: new Date().toISOString(),
      };
      setPin(''); setWithPassword(false); setExpiry(DEFAULT_EXPIRY);
      setPhase({ kind: 'ready', share: info });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible');
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setShares((xs) => xs.filter((x) => x.id !== id));
    try { await api.deleteShare(id); } catch { void refresh(); }
  };

  const shareUrl = async (url: string) => {
    if (navigator.share) { try { await navigator.share({ url }); return; } catch { /* annulé */ } }
    try { await navigator.clipboard.writeText(url); } catch { /* contexte non sécurisé */ }
  };
  const copyUrl = async (url: string) => { try { await navigator.clipboard.writeText(url); } catch { /* */ } };

  return (
    <div onClick={onClose} style={sheetWrap}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={sheetBody}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />

        {phase.kind === 'list' && (
          <>
            <h3 style={{ fontSize: 17, fontWeight: 680, marginBottom: 2 }}>Liens de ce réel</h3>
            <p style={{ fontSize: 12.5, color: 'var(--txt-2)', marginBottom: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{videoTitle}</p>
            {loading && shares.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid var(--hairline-strong)', borderTopColor: 'var(--a-violet)', display: 'block', animation: 'spin 0.7s linear infinite' }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {shares.map((s) => {
                const b = statusBadge(s);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 11px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 620, color: b.color }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />{b.label}
                      </span>
                      <div style={{ fontSize: 11, color: 'var(--txt-2)', marginTop: 4, display: 'flex', gap: 9, alignItems: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.view_count} vues</span>
                        {s.has_password && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icons.lock size={12} /> code</span>}
                      </div>
                    </div>
                    <button onClick={() => shareUrl(s.url)} aria-label="Partager le lien" style={iconBtn}><Icons.share size={15} /></button>
                    <button onClick={() => copyUrl(s.url)} aria-label="Copier le lien" style={iconBtn}><Icons.copy size={15} /></button>
                    <button onClick={() => revoke(s.id)} aria-label="Révoquer le lien" style={{ ...iconBtn, color: '#ff8a96' }}><Icons.trash size={15} /></button>
                  </div>
                );
              })}
            </div>
            )}
            <button onClick={() => setPhase({ kind: 'configure' })} style={newLinkBtn}><Icons.plus size={17} /> Nouveau lien</button>
          </>
        )}

        {phase.kind === 'configure' && (
          <>
            <h3 style={{ fontSize: 17, fontWeight: 680, marginBottom: 16 }}>Partager ce réel</h3>
            <p style={labelStyle}>Durée du lien</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {EXPIRY_OPTIONS.map((o) => {
                const sel = o.value === expiry;
                return (
                  <button key={o.label} onClick={() => setExpiry(o.value)} style={{
                    padding: '11px 0', borderRadius: 13, fontSize: 13.5, fontWeight: sel ? 700 : 560,
                    color: sel ? '#160d18' : 'var(--txt-1)', background: sel ? 'var(--grad-accent)' : 'var(--bg-3)',
                    border: '1px solid ' + (sel ? 'transparent' : 'var(--hairline)'),
                  }}>{o.label}</button>
                );
              })}
            </div>
            <button onClick={() => setWithPassword((v) => !v)} role="switch" aria-checked={withPassword}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline)', marginBottom: withPassword ? 10 : 20 }}>
              <Icons.lock size={17} style={{ color: 'var(--txt-1)' }} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 14, color: 'var(--txt-0)' }}>Protéger par un code</span>
              <span style={{ width: 44, height: 26, borderRadius: 999, background: withPassword ? 'var(--grad-accent)' : 'var(--bg-3)', border: '1px solid var(--hairline)', position: 'relative' }}>
                <span style={{ position: 'absolute', top: 2, left: withPassword ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: withPassword ? '#fff' : 'var(--txt-2)', transition: 'left .2s' }} />
              </span>
            </button>
            {withPassword && (
              <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus placeholder="Code (ex. 4 chiffres)"
                style={{ width: '100%', height: 50, padding: '0 16px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', color: 'var(--txt-0)', fontSize: 16, outline: 'none', marginBottom: 20 }} />
            )}
            {error && <p style={{ fontSize: 13, color: '#ff8a96', marginBottom: 10 }}>{error}</p>}
            <button className="btn-primary" disabled={busy || (withPassword && !pin)} onClick={create}>
              <Icons.share size={18} /> {busy ? 'Création…' : 'Créer le lien'}
            </button>
            {shares.length > 0 && <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setPhase({ kind: 'list' })}>Voir les liens existants</button>}
          </>
        )}

        {phase.kind === 'ready' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(94,226,160,0.15)', color: '#5ee2a0', display: 'grid', placeItems: 'center' }}><Icons.check size={17} /></span>
              <b style={{ fontSize: 16, fontWeight: 680 }}>Lien créé</b>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 14px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', marginBottom: 10 }}>
              <Icons.globe size={16} style={{ color: 'var(--txt-2)' }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--txt-0)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{phase.share.url}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--txt-2)', marginBottom: 18 }}>
              <Icons.clock size={14} /> {formatExpiry(phase.share.expires_at)}{phase.share.has_password ? ' · code requis' : ' · sans code'}
            </div>
            <button className="btn-primary" onClick={() => shareUrl(phase.share.url)}><Icons.share size={18} /> Partager…</button>
            <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => copyUrl(phase.share.url)}><Icons.copy size={16} /> Copier le lien</button>
            <button onClick={() => setPhase({ kind: 'list' })} style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--a-violet)', fontWeight: 600, background: 'none', border: 'none' }}>Gérer les liens de ce réel →</button>
          </>
        )}
      </div>
    </div>
  );
}

const iconBtn: CSSProperties = { width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: 'var(--txt-1)', flex: '0 0 auto' };
const newLinkBtn: CSSProperties = { width: '100%', height: 48, marginTop: 14, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--a-violet)', background: 'rgba(167,139,250,0.1)', border: '1px dashed rgba(167,139,250,0.45)' };
const labelStyle: CSSProperties = { fontSize: 10.5, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 9px' };
