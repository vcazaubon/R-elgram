// ============================================================
// Réelgram — Login / unlock (private vault gate)
// Visual ported pixel-perfect from design-reference/project/screens-login.jsx
// (brand, ambient glow, gradient, rise anim, proto spinner). Actions are
// real auth: email + password (Supabase) + an optional Face ID local lock.
// Apple button and magic-link removed per Spec 04.
// ============================================================
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import { config } from '../lib/config';
import { useAuth } from '../lib/auth';
import { mapAuthError } from '../lib/authLogic';

export interface LoginScreenProps {
  /** Called once authenticated AND (if applicable) biometrically unlocked. */
  onEnter: () => void;
  /** When true, render the Face ID lock variant (session exists, credential enrolled). */
  biometricLock?: boolean;
  /** Attempt biometric unlock — resolves true on success. Provided by App. */
  onBiometricUnlock?: () => Promise<boolean>;
}

type Tab = 'signin' | 'signup';
type Busy = 'submit' | 'faceid' | null;

const spinner = (light: boolean): CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: `2.4px solid ${light ? 'rgba(18,10,20,0.4)' : 'rgba(255,255,255,0.3)'}`,
  borderTopColor: light ? '#120a14' : '#fff',
  animation: 'spin 0.7s linear infinite',
});

export function LoginScreen({ onEnter, biometricLock = false, onBiometricUnlock }: LoginScreenProps) {
  const { signIn, signUp } = useAuth();
  // When locked, start on the Face ID view; password fallback can override.
  const [locked, setLocked] = useState(biometricLock);
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const signupEnabled = config.allowSignups;
  const canSubmit = email.includes('@') && password.length >= 6 && busy === null;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy('submit');
    setError(null);
    setInfo(null);
    const action = tab === 'signup' && signupEnabled ? signUp : signIn;
    const { error: err } = await action(email.trim(), password);
    if (err) {
      setBusy(null);
      setError(mapAuthError(err));
      return;
    }
    if (tab === 'signup' && signupEnabled) {
      // If email confirmation is required, there is no session yet; surface it
      // gently instead of dropping into an unauthenticated "enter".
      setInfo("Compte créé. Si un email de confirmation t'est envoyé, valide-le pour continuer.");
    }
    setBusy(null);
    // App's auth state listener decides the route; calling onEnter is harmless
    // (it only navigates when a session is actually present).
    onEnter();
  };

  const tryBiometric = async () => {
    if (!onBiometricUnlock || busy) return;
    setBusy('faceid');
    setError(null);
    const ok = await onBiometricUnlock();
    setBusy(null);
    if (ok) {
      onEnter();
    } else {
      setError('Déverrouillage Face ID annulé ou échoué.');
    }
  };

  return (
    <div className="view" style={{ background: 'var(--bg-0)' }}>
      <StatusBar />

      {/* ambient gradient field */}
      <div style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', width: 420, height: 420, borderRadius: '50%', background: 'var(--grad-accent)', filter: 'blur(90px)', opacity: 0.22, pointerEvents: 'none' }} />

      <div className="scroll" style={{ display: 'flex', flexDirection: 'column', padding: '0 26px' }}>
        {/* brand */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 30 }}>
          <div className="rise" style={{ position: 'relative', width: 96, height: 96, marginBottom: 26 }}>
            <div style={{ position: 'absolute', inset: -16, borderRadius: 34, background: 'var(--grad-accent)', filter: 'blur(30px)', opacity: 0.45 }} />
            <div style={{ position: 'relative', width: 96, height: 96, borderRadius: 28, background: 'var(--grad-accent)', display: 'grid', placeItems: 'center', boxShadow: '0 20px 50px -16px rgba(255,126,179,0.5), inset 0 1px 0 rgba(255,255,255,0.4)' }}>
              <Icons.play size={42} style={{ marginLeft: 4, color: '#120a14' }} />
            </div>
          </div>
          <h1 className="rise" style={{ animationDelay: '0.05s', fontSize: 34, fontWeight: 720, letterSpacing: '-0.04em' }}>Réelgram</h1>
          <p className="rise" style={{ animationDelay: '0.1s', marginTop: 12, fontSize: 16, color: 'var(--txt-1)', textAlign: 'center', lineHeight: 1.5, maxWidth: 270 }}>
            Ton vault privé de Reels. Verrouillé, rien que pour toi.
          </p>
        </div>

        {/* auth actions */}
        <div className="rise" style={{ animationDelay: '0.16s', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 30px)', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {locked ? (
            <>
              {/* Face ID quick unlock (visual identical to proto primary button) */}
              <button onClick={tryBiometric} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: 18,
                background: 'var(--grad-accent)', color: '#120a14', fontSize: 16.5, fontWeight: 660,
                boxShadow: '0 14px 34px -12px rgba(255,126,179,0.5)',
              }}>
                {busy === 'faceid'
                  ? <span style={spinner(true)} />
                  : <><FaceIdGlyph /> Déverrouiller avec Face ID</>}
              </button>

              {error && (
                <p style={{ fontSize: 13.5, color: '#ff8a96', textAlign: 'center', lineHeight: 1.45, marginTop: 2 }}>{error}</p>
              )}

              <button onClick={() => { setLocked(false); setError(null); }} style={{ fontSize: 14, color: 'var(--txt-2)', padding: 10, fontWeight: 540 }}>
                Utiliser le mot de passe
              </button>
            </>
          ) : (
            <div className="view-enter" style={{ position: 'static', display: 'flex', flexDirection: 'column', gap: 11 }}>
              {/* signin / signup toggle */}
              {signupEnabled && (
                <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline)', marginBottom: 4 }}>
                  {(['signin', 'signup'] as const).map((t) => (
                    <button key={t} onClick={() => { setTab(t); setError(null); setInfo(null); }} style={{
                      flex: 1, height: 38, borderRadius: 10, fontSize: 14.5, fontWeight: 600,
                      color: tab === t ? '#120a14' : 'var(--txt-1)',
                      background: tab === t ? 'var(--grad-accent)' : 'transparent',
                    }}>
                      {t === 'signin' ? 'Se connecter' : 'Créer un compte'}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px', height: 54, borderRadius: 16, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)' }}>
                <input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ton@email.com" inputMode="email" autoComplete="email"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 16 }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px', height: 54, borderRadius: 16, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)' }}>
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Mot de passe"
                  autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 16 }} />
              </div>

              {error && (
                <p style={{ fontSize: 13.5, color: '#ff8a96', lineHeight: 1.45, padding: '0 2px' }}>{error}</p>
              )}
              {info && !error && (
                <p style={{ fontSize: 13.5, color: 'var(--txt-1)', lineHeight: 1.45, padding: '0 2px' }}>{info}</p>
              )}

              <button className="btn-primary" onClick={() => void submit()}
                style={{ opacity: canSubmit ? 1 : 0.55, pointerEvents: canSubmit ? 'auto' : 'none' }}>
                {busy === 'submit'
                  ? <span style={spinner(true)} />
                  : <>{tab === 'signup' && signupEnabled ? 'Créer mon compte' : 'Se connecter'}</>}
              </button>
            </div>
          )}

          <p style={{ marginTop: 6, fontSize: 12, color: 'var(--txt-3)', textAlign: 'center', lineHeight: 1.5 }}>
            Aucun compte public, aucun feed. Tes vidéos restent privées.
          </p>
        </div>
      </div>
    </div>
  );
}

function FaceIdGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 10v1M15 10v1M12 9.5v3.5M10.5 12h-.5" />
      <path d="M9 15.5c.9.8 1.9 1.1 3 1.1s2.1-.3 3-1.1" />
    </svg>
  );
}
