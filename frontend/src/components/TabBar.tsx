// ============================================================
// Réelgram — Bottom tab bar
// Ported from design-reference/project/components.jsx.
// ============================================================
import type { ReactNode } from 'react';
import { Icons, type IconProps } from './Icons';

export type TabId = 'library' | 'categories';

export interface TabBarProps {
  tab: TabId;
  onTab: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: 'library', label: 'Bibliothèque', Icon: Icons.library },
  { id: 'categories', label: 'Catégories', Icon: Icons.grid },
];

export function TabBar({ tab, onTab }: TabBarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        padding: '10px 22px calc(env(safe-area-inset-bottom, 0px) + 18px)',
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        background: 'linear-gradient(180deg, transparent, rgba(10,10,12,0.85) 38%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 6,
          borderRadius: 999,
          background: 'var(--glass)',
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          border: '1px solid var(--hairline)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        {tabs.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 44,
                padding: '0 18px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                transition: 'all 0.28s var(--ease)',
                color: on ? '#0a0a0c' : 'var(--txt-1)',
                background: on ? 'var(--grad-accent)' : 'transparent',
              }}
            >
              <Icon size={19} /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
