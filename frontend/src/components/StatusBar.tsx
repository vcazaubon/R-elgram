// ============================================================
// Réelgram — Status bar
// Ported from design-reference/project/components.jsx.
// Faux iOS bar for the prototype; in a real installed PWA
// (window.__REELGRAM_PWA === true) it collapses to a safe-area
// spacer so the REAL device status bar shows through instead.
// ============================================================
import { useState } from 'react';
import { Icons } from './Icons';

export interface StatusBarProps {
  dark?: boolean;
}

export function StatusBar({ dark = true }: StatusBarProps) {
  const [now] = useState(() => '9:41');
  if (window.__REELGRAM_PWA) {
    return <div style={{ height: 'env(safe-area-inset-top, 0px)', flex: '0 0 auto' }} />;
  }
  return (
    <div className="statusbar" style={{ color: dark ? 'var(--txt-0)' : '#0a0a0c' }}>
      <span>{now}</span>
      <div className="sb-right">
        <Icons.signal size={17} />
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 5.5c3 0 5.7 1.1 7.7 3l-1.5 1.5A8.7 8.7 0 0 0 12 8.5 8.7 8.7 0 0 0 5.8 10L4.3 8.5C6.3 6.6 9 5.5 12 5.5zm0 4.2c1.8 0 3.5.7 4.8 1.9l-1.5 1.5A5 5 0 0 0 12 11.7c-1.3 0-2.5.5-3.3 1.4L7.2 11.6A6.9 6.9 0 0 1 12 9.7zm0 4.1c.8 0 1.5.3 2 .9L12 16.7l-2-2a2.8 2.8 0 0 1 2-.9z" />
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{ width: 24, height: 12, borderRadius: 3.5, border: '1.4px solid currentColor', opacity: 0.55, position: 'relative', padding: 1.5 }}>
            <div style={{ position: 'absolute', inset: 1.5, width: '78%', background: 'currentColor', borderRadius: 1.5 }} />
          </div>
          <div style={{ width: 1.6, height: 4, background: 'currentColor', opacity: 0.45, borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}
