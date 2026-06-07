// ============================================================
// Réelgram — Login / unlock (private vault gate)
// Ported from design-reference/project/screens-login.jsx.
// Mock: onEnter is triggered directly (auth wired in Spec 04).
// ============================================================
import { useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';

export interface LoginScreenProps {
  onEnter: () => void;
}

type Mode = 'welcome' | 'email';
type Loading = 'apple' | 'faceid' | 'email' | null;

export function LoginScreen({ onEnter }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>('welcome');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<Loading>(null);

  const trigger = (kind: Exclude<Loading, null>) => {
    setLoading(kind);
    setTimeout(onEnter, kind === 'faceid' ? 900 : 1100);
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
          {mode === 'welcome' && (
            <>
              {/* Face ID quick unlock */}
              <button onClick={() => trigger('faceid')} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: 18,
                background: 'var(--grad-accent)', color: '#120a14', fontSize: 16.5, fontWeight: 660,
                boxShadow: '0 14px 34px -12px rgba(255,126,179,0.5)',
              }}>
                {loading === 'faceid'
                  ? <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.4px solid rgba(18,10,20,0.4)', borderTopColor: '#120a14', animation: 'spin 0.7s linear infinite' }} />
                  : <><FaceIdGlyph /> Déverrouiller avec Face ID</>}
              </button>

              {/* Apple */}
              <button onClick={() => trigger('apple')} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, height: 54, borderRadius: 16,
                background: '#f4f4f6', color: '#0a0a0c', fontSize: 15.5, fontWeight: 600,
              }}>
                {loading === 'apple'
                  ? <span style={{ width: 17, height: 17, borderRadius: '50%', border: '2.2px solid rgba(10,10,12,0.3)', borderTopColor: '#0a0a0c', animation: 'spin 0.7s linear infinite' }} />
                  : <><AppleGlyph /> Continuer avec Apple</>}
              </button>

              <button className="btn-ghost" onClick={() => setMode('email')}>Continuer avec un e-mail</button>
            </>
          )}

          {mode === 'email' && (
            <div className="view-enter" style={{ position: 'static', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px', height: 54, borderRadius: 16, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)' }}>
                <input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ton@email.com" inputMode="email"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--txt-0)', fontSize: 16 }} />
              </div>
              <button className="btn-primary" onClick={() => trigger('email')} style={{ opacity: email.includes('@') ? 1 : 0.55, pointerEvents: email.includes('@') ? 'auto' : 'none' }}>
                {loading === 'email'
                  ? <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.4px solid rgba(18,10,20,0.4)', borderTopColor: '#120a14', animation: 'spin 0.7s linear infinite' }} />
                  : <>Recevoir le lien magique</>}
              </button>
              <button onClick={() => setMode('welcome')} style={{ fontSize: 14, color: 'var(--txt-2)', padding: 10, fontWeight: 540 }}>Retour</button>
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

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.9c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.2 5.9c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z" /></svg>
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
