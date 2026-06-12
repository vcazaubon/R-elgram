// frontend/src/public/PublicShareApp.tsx
// Page destinataire : brandée, mobile-first. Réutilise des helpers PURS
// (Icons) — JAMAIS de composant couplé à l'auth.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { Icons } from '../components/Icons';
import { resolveShare, unlockShare, type PublicMeta, type ResolveResult } from './publicApi';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: PublicMeta }
  | { kind: 'password'; error?: string }
  | { kind: 'gone' }
  | { kind: 'notfound' };

const ACCENT = 'linear-gradient(115deg,#ff7eb3 0%,#ff9966 48%,#a78bfa 100%)';

export function PublicShareApp() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    resolveShare().then((r: ResolveResult) => {
      if (r.state === 'ok') setView({ kind: 'ready', meta: r.meta });
      else if (r.state === 'password') setView({ kind: 'password' });
      else if (r.state === 'gone') setView({ kind: 'gone' });
      else setView({ kind: 'notfound' });
    }).catch(() => setView({ kind: 'gone' }));
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#060608', color: '#f4f4f6', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} html,body{margin:0;padding:0;background:#060608} .scroll::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(85% 50% at 50% 22%, rgba(167,139,250,0.3), transparent 62%)', filter: 'blur(22px)' }} />
      <Wordmark />
      {view.kind === 'loading' && <Centered><Spinner /></Centered>}
      {view.kind === 'ready' && <ReadyView meta={view.meta} />}
      {view.kind === 'password' && <PasswordGate error={view.error} onUnlock={(m) => setView({ kind: 'ready', meta: m })} onError={(e) => setView({ kind: 'password', error: e })} />}
      {view.kind === 'gone' && <EdgeState icon={<Icons.clock size={28} />} title="Ce lien n'est plus actif" sub="Il a peut-être expiré ou été révoqué par son auteur." />}
      {view.kind === 'notfound' && <EdgeState icon={<Icons.globe size={28} />} title="Lien introuvable" sub="Vérifie l'adresse, ou demande un nouveau lien." />}
      <Footer />
    </div>
  );
}

function Wordmark() {
  return (
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '16px 0 12px' }}>
      <span style={{ width: 17, height: 17, borderRadius: 5, background: ACCENT }} />
      <span style={{ fontSize: 14.5, fontWeight: 740, background: ACCENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Réelgram</span>
    </div>
  );
}
function Footer() {
  return <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '14px 0 16px', fontSize: 11.5, color: '#76768a' }}>Partagé via Réelgram</div>;
}
function Centered({ children }: { children: ReactNode }) {
  return <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'grid', placeItems: 'center' }}>{children}</div>;
}
function Spinner() {
  return <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2.6px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />;
}

function ReadyView({ meta }: { meta: PublicMeta }) {
  return meta.media_type === 'image'
    ? <Carousel slides={meta.slides ?? []} title={meta.title} />
    : <VideoView src={meta.stream_url ?? ''} title={meta.title} />;
}

function VideoView({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => { const el = ref.current; if (!el) return; if (el.paused) { void el.play().catch(() => {}); } else { el.pause(); } };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div onClick={toggle} style={{ position: 'relative', flex: 1, margin: '0 16px', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#000', boxShadow: '0 30px 60px -28px #000' }}>
        <video ref={ref} src={src} playsInline autoPlay onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {!playing && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.25)' }}>
            <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(10,10,12,0.42)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center' }}><Icons.play size={26} style={{ marginLeft: 3 }} /></div>
          </div>
        )}
      </div>
      <h1 style={{ margin: '14px 18px 0', fontSize: 16.5, fontWeight: 680, letterSpacing: '-0.01em' }}>{title}</h1>
    </div>
  );
}

function Carousel({ slides, title }: { slides: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ position: 'relative', flex: 1, margin: '0 16px', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
        <div onScroll={onScroll} className="scroll" style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
          {slides.map((src, i) => (
            <div key={i} style={{ position: 'relative', flex: '0 0 100%', height: '100%', scrollSnapAlign: 'center', display: 'grid', placeItems: 'center' }}>
              <img src={src} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.5)', transform: 'scale(1.2)' }} />
              <img src={src} alt={`Photo ${i + 1}`} style={{ position: 'relative', maxWidth: '92%', maxHeight: '100%', objectFit: 'contain', borderRadius: 16 }} />
            </div>
          ))}
        </div>
        {slides.length > 1 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', gap: 6 }}>
            {slides.map((_, i) => <span key={i} style={{ width: i === active ? 18 : 6, height: 6, borderRadius: 9, background: i === active ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all .2s' }} />)}
          </div>
        )}
      </div>
      <h1 style={{ margin: '14px 18px 0', fontSize: 16.5, fontWeight: 680 }}>{title}</h1>
    </div>
  );
}

function PasswordGate({ error, onUnlock, onError }: { error?: string; onUnlock: (m: PublicMeta) => void; onError: (e: string) => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const meta = await unlockShare(pin);
    setBusy(false);
    if (meta) onUnlock(meta); else onError('Code incorrect');
  };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(167,139,250,0.14)', color: '#a78bfa', display: 'grid', placeItems: 'center', marginBottom: 18 }}><Icons.lock size={28} /></div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 7 }}>Réel protégé</h3>
      <p style={{ fontSize: 13, color: '#b8b8c4', marginBottom: 18 }}>Saisis le code qu'on t'a communiqué pour voir ce réel.</p>
      <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus placeholder="Code"
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        style={{ width: '100%', maxWidth: 240, height: 50, textAlign: 'center', borderRadius: 14, background: '#16161c', border: '1px solid rgba(255,255,255,0.14)', color: '#f4f4f6', fontSize: 18, outline: 'none', marginBottom: error ? 8 : 18 }} />
      {error && <p style={{ fontSize: 13, color: '#ff8a96', marginBottom: 14 }}>{error}</p>}
      <button disabled={busy || !pin} onClick={() => void submit()} style={{ width: '100%', maxWidth: 240, height: 50, borderRadius: 15, fontSize: 15, fontWeight: 660, color: '#160d18', background: ACCENT, border: 'none' }}>{busy ? '…' : 'Voir le réel'}</button>
    </div>
  );
}

function EdgeState({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#1e1e26', color: '#76768a', display: 'grid', placeItems: 'center', marginBottom: 18 }}>{icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 7 }}>{title}</h3>
      <p style={{ fontSize: 13, color: '#b8b8c4' }}>{sub}</p>
    </div>
  );
}
