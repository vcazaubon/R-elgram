// ============================================================
// Réelgram — Account / iOS Shortcut sheet (Spec 05 T6)
// Bottom sheet (same chrome as PlayerSheet) opened from the Library header
// Account button. Shows the signed-in email, manages personal API tokens for
// the iOS Shortcut (create → plaintext shown ONCE + copy, list + revoke),
// offers a Face ID toggle (enroll/clear via biometric), and Sign out.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../components/Icons';
import { useAuth } from '../lib/auth';
import * as api from '../lib/api';
import type { ApiToken } from '../lib/types';
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  enrollBiometric,
  clearBiometric,
} from '../lib/biometric';

export interface AccountSheetProps {
  onClose: () => void;
  onSignOut: () => void;
}

function userKeyOf(id: string | undefined | null): string | null {
  return id ? `u:${id}` : null;
}

export function AccountSheet({ onClose, onSignOut }: AccountSheetProps) {
  const { user } = useAuth();
  const email = user?.email ?? '—';
  const userKey = userKeyOf(user?.id);

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);
  // Plaintext of a just-created token, shown ONCE.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Exact backend ingest endpoint the iOS Shortcut must POST to.
  const ingestUrl = `${window.location.origin}/api/ingest`;
  const [urlCopied, setUrlCopied] = useState(false);

  // Face ID
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(userKey ? isBiometricEnrolled(userKey) : false);

  const refreshTokens = useCallback(async () => {
    setLoadingTokens(true);
    setTokensError(null);
    try {
      const list = await api.listTokens();
      setTokens(list);
    } catch (e) {
      setTokensError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  useEffect(() => { void refreshTokens(); }, [refreshTokens]);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then((ok) => { if (active) setBioAvailable(ok); });
    return () => { active = false; };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setTokensError(null);
    try {
      const created = await api.createToken('Raccourci iOS');
      setFreshToken(created.token);
      setCopied(false);
      await refreshTokens();
    } catch (e) {
      setTokensError(e instanceof Error ? e.message : 'Impossible de générer le token');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable (insecure context); leave the value visible.
      setCopied(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(ingestUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1600);
    } catch {
      // Clipboard unavailable: the URL stays visible for manual copy.
      setUrlCopied(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setTokensError(null);
    try {
      await api.deleteToken(id);
      await refreshTokens();
    } catch (e) {
      setTokensError(e instanceof Error ? e.message : 'Révocation impossible');
    }
  };

  const handleToggleBio = async () => {
    if (!userKey) return;
    if (bioEnrolled) {
      clearBiometric(userKey);
      setBioEnrolled(false);
    } else {
      const ok = await enrollBiometric(userKey);
      setBioEnrolled(ok);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', animation: 'fadeBg 0.25s ease both' }}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)', borderBottom: 'none',
        padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)', animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)', maxHeight: '88%', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />

        {/* identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--grad-accent-soft)', border: '1px solid var(--hairline)', display: 'grid', placeItems: 'center', color: 'var(--a-violet)', flex: '0 0 auto' }}>
            <Icons.user size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--txt-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Compte</div>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--txt-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
          </div>
        </div>

        {/* iOS Shortcut section */}
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 700, color: 'var(--txt-1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <Icons.key size={17} style={{ color: 'var(--a-violet)' }} /> Raccourci iOS
          </div>
          <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--txt-2)', lineHeight: 1.5 }}>
            Génère un token, puis crée un Raccourci iOS qui partage une vidéo Instagram vers ton vault.
          </p>

          {/* exact ingest endpoint for the Shortcut (copyable) */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 15, background: 'var(--bg-2)', border: '1px solid var(--hairline)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--txt-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 }}>Endpoint du Raccourci (POST)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <code style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, color: 'var(--txt-0)', wordBreak: 'break-all' }}>{ingestUrl}</code>
              <button onClick={handleCopyUrl} aria-label="Copier l'URL de l'API" style={{ flex: '0 0 auto', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: urlCopied ? '#0a0a0c' : 'var(--txt-0)', background: urlCopied ? 'var(--grad-accent)' : 'var(--bg-3)', border: '1px solid var(--hairline)' }}>
                {urlCopied ? <Icons.check size={17} /> : <Icons.copy size={17} />}
              </button>
            </div>
          </div>

          {/* concise inline recipe + reference to the full guide */}
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 15, background: 'var(--bg-1)', border: '1px solid var(--hairline)', fontSize: 13, color: 'var(--txt-2)', lineHeight: 1.6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--txt-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Configuration du Raccourci</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Génère un token ci-dessous et copie-le.</li>
              <li>Raccourcis iOS → nouveau → active « Afficher dans la feuille de partage » (entrée URL).</li>
              <li>Action « Obtenir le contenu d'une URL » → <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>POST</code> vers l'endpoint ci-dessus.</li>
              <li>En-têtes : <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>X-Reelgram-Token</code> + <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>Content-Type: application/json</code>.</li>
              <li>Corps JSON : <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{'{ "url": <Entrée> }'}</code>.</li>
            </ol>
            <div style={{ marginTop: 9, fontSize: 12.5, color: 'var(--txt-3)' }}>
              Guide pas-à-pas complet : <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--txt-2)' }}>docs/ios-shortcut.md</code>
            </div>
          </div>

          {/* freshly created token, shown once */}
          {freshToken && (
            <div style={{ marginTop: 14, padding: 14, borderRadius: 15, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)' }}>
              <div style={{ fontSize: 12, color: 'var(--txt-2)', marginBottom: 8 }}>Copie-le maintenant — il ne sera plus affiché.</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <code style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: 'var(--txt-0)', wordBreak: 'break-all' }}>{freshToken}</code>
                <button onClick={handleCopy} aria-label="Copier le token" style={{ flex: '0 0 auto', width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', color: copied ? '#0a0a0c' : 'var(--txt-0)', background: copied ? 'var(--grad-accent)' : 'var(--bg-3)', border: '1px solid var(--hairline)' }}>
                  {copied ? <Icons.check size={18} /> : <Icons.copy size={18} />}
                </button>
              </div>
            </div>
          )}

          {/* generate */}
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={handleCreate} disabled={creating}>
            <Icons.plus size={19} /> {creating ? 'Génération…' : 'Générer un token'}
          </button>

          {tokensError && (
            <p style={{ marginTop: 10, fontSize: 13, color: '#ff8a96' }}>{tokensError}</p>
          )}

          {/* existing tokens */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loadingTokens ? (
              <div style={{ padding: '14px 0', textAlign: 'center' }}>
                <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: '50%', border: '2.2px solid var(--hairline-strong)', borderTopColor: 'var(--a-violet)', animation: 'spin 0.7s linear infinite' }} />
              </div>
            ) : tokens.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--txt-3)' }}>Aucun token actif.</p>
            ) : tokens.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--hairline)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 560, color: 'var(--txt-0)' }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 2 }}>
                    {t.last_used_at ? 'Utilisé récemment' : 'Jamais utilisé'}
                  </div>
                </div>
                <button onClick={() => handleRevoke(t.id)} aria-label="Révoquer le token" style={{ flex: '0 0 auto', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: '#ff8a96', background: 'var(--bg-3)', border: '1px solid var(--hairline)' }}>
                  <Icons.trash size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Connexion: explicit choice between direct entry and a Face ID lock
            asked on every open. OFF clears the local credential (direct entry);
            ON enrolls (Face ID prompt). The Supabase session persists either
            way — this only controls the per-open LOCAL lock (a WebAuthn passkey
            gated by Face ID; a web PWA cannot use the native Face ID API). */}
        {bioAvailable && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 700, color: 'var(--txt-1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Icons.user size={17} style={{ color: 'var(--a-violet)' }} /> Connexion
            </div>
            <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--txt-2)', lineHeight: 1.5 }}>
              Choisis comment l’app s’ouvre : directement, ou en demandant Face ID à chaque fois.
            </p>
            <button onClick={handleToggleBio} role="switch" aria-checked={bioEnrolled}
              style={{ marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--hairline)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--grad-accent-soft)', border: '1px solid var(--hairline)', display: 'grid', placeItems: 'center', color: 'var(--a-violet)', flex: '0 0 auto' }}>
                <Icons.user size={19} />
              </div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 560, color: 'var(--txt-0)' }}>Demander Face ID à chaque ouverture</div>
                <div style={{ fontSize: 12.5, color: 'var(--txt-2)', marginTop: 2, lineHeight: 1.4 }}>
                  {bioEnrolled
                    ? 'Activé : ton vault se déverrouille avec Face ID à chaque ouverture.'
                    : 'Désactivé : accès direct, tu restes connecté sans Face ID.'}
                </div>
              </div>
              <span style={{ flex: '0 0 auto', width: 46, height: 28, borderRadius: 999, background: bioEnrolled ? 'var(--grad-accent)' : 'var(--bg-3)', border: '1px solid var(--hairline)', position: 'relative', transition: 'background 0.25s var(--ease)' }}>
                <span style={{ position: 'absolute', top: 2.5, left: bioEnrolled ? 21 : 2.5, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.4)', transition: 'left 0.25s var(--ease)' }} />
              </span>
            </button>
          </div>
        )}

        {/* sign out */}
        <button onClick={onSignOut} style={{ marginTop: 22, width: '100%', height: 54, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 15.5, fontWeight: 600, color: '#ff8a96', background: 'var(--bg-2)', border: '1px solid var(--hairline)' }}>
          <Icons.logout size={20} /> Déconnexion
        </button>
      </div>
    </div>
  );
}
