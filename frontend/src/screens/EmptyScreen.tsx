// ============================================================
// Réelgram — Empty library (hero + 3 steps + CTA)
// Ported from design-reference/project/screens-main.jsx → EmptyScreen.
// ============================================================
import type { ReactNode } from 'react';
import { Icons, type IconProps } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import { TabBar, type TabId } from '../components/TabBar';

export interface EmptyScreenProps {
  onAdd: () => void;
  onTab: (tab: TabId) => void;
  tab: TabId;
}

interface Step {
  n: string;
  t: string;
  icon: (p: IconProps) => ReactNode;
}

export function EmptyScreen({ onAdd, onTab, tab }: EmptyScreenProps) {
  const steps: Step[] = [
    { n: '1', t: 'Partage depuis Instagram', icon: Icons.insta },
    { n: '2', t: 'Réelgram sauvegarde', icon: Icons.sparkle },
    { n: '3', t: 'Tu regardes quand tu veux', icon: Icons.play },
  ];
  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 22px 0' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em' }}>Réelgram</h1>
        </div>

        {/* hero visual */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 30px 10px' }}>
          <div className="rise" style={{ position: 'relative', width: 168, height: 168, marginBottom: 6 }}>
            {/* glow */}
            <div style={{ position: 'absolute', inset: -30, borderRadius: '50%', background: 'var(--grad-accent)', filter: 'blur(46px)', opacity: 0.28 }} />
            {/* stacked cards illustration */}
            <div style={{ position: 'absolute', inset: 0 }}>
              <div style={{ position: 'absolute', top: 30, left: 26, width: 116, height: 116, borderRadius: 26, background: 'var(--bg-3)', border: '1px solid var(--hairline)', transform: 'rotate(-11deg)', boxShadow: 'var(--shadow-card)' }} />
              <div style={{ position: 'absolute', top: 24, left: 30, width: 116, height: 116, borderRadius: 26, background: 'var(--bg-2)', border: '1px solid var(--hairline)', transform: 'rotate(7deg)', boxShadow: 'var(--shadow-card)' }} />
              <div style={{ position: 'absolute', top: 20, left: 28, width: 116, height: 116, borderRadius: 26, overflow: 'hidden', border: '1px solid var(--hairline-strong)', boxShadow: 'var(--shadow-pop)', background: 'linear-gradient(150deg,#3a1f5c,#8a2e6b)' }}>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(10,10,12,0.4)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center' }}>
                    <Icons.play size={20} style={{ marginLeft: 2, color: '#fff' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h2 className="rise" style={{ animationDelay: '0.06s', marginTop: 22, fontSize: 22, fontWeight: 680, letterSpacing: '-0.02em', textAlign: 'center', lineHeight: 1.25, maxWidth: 280 }}>
            Ta bibliothèque est prête
          </h2>
          <p className="rise" style={{ animationDelay: '0.1s', marginTop: 10, fontSize: 15.5, color: 'var(--txt-1)', textAlign: 'center', lineHeight: 1.5, maxWidth: 290 }}>
            Partage un Reel depuis Instagram pour commencer.
          </p>
        </div>

        {/* 3 steps */}
        <div className="rise" style={{ animationDelay: '0.14s', padding: '0 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px', borderRadius: 16,
              background: 'var(--bg-1)', border: '1px solid var(--hairline)',
            }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--grad-accent-soft)', border: '1px solid var(--hairline)', display: 'grid', placeItems: 'center', color: 'var(--txt-0)', flex: '0 0 auto' }}>
                <s.icon size={19} />
              </div>
              <span style={{ fontSize: 15, color: 'var(--txt-0)', fontWeight: 520 }}>{s.t}</span>
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--txt-3)' }}>{s.n}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '24px 22px 8px' }}>
          <button className="btn-primary" onClick={onAdd}><Icons.link size={20} /> Ajouter une URL</button>
        </div>
      </div>
      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}
