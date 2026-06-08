// ============================================================
// Réelgram — toast de fin d'import (succès / erreur)
// Présentationnel : affiche un toast en bas, au-dessus de la barre d'onglets.
// Tap → onTap (puis fermeture) ; auto-disparition après ~4 s. La file et les
// handlers vivent dans App.tsx. App rend UN Toast à la fois (keyé), ce qui
// ré-arme le timer à chaque nouveau toast.
// ============================================================
import { useEffect, useRef } from 'react';
import type { ToastKind } from '../lib/importToasts';
import { Icons } from './Icons';

export interface ToastProps {
  kind: ToastKind;
  title: string;
  onTap: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export function Toast({ kind, title, onTap, onDismiss }: ToastProps) {
  // Auto-disparition. onDismiss est lu via une ref pour ne pas relancer le
  // timer à chaque re-render (le timer s'arme une fois par toast monté).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const id = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, []);

  const success = kind === 'success';
  const label = success ? `« ${title} » ajouté` : "Échec de l'import";

  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <button
        className="rise"
        onClick={() => { onTap(); onDismiss(); }}
        style={{
          pointerEvents: 'auto',
          maxWidth: 420,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderRadius: 14,
          textAlign: 'left',
          color: '#fff',
          background: 'rgba(10,10,12,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: success ? 'rgba(120,220,150,0.16)' : 'rgba(255,93,108,0.16)',
            color: success ? '#7be0a0' : '#ff8a96',
          }}
        >
          {success ? <Icons.check size={16} /> : <Icons.close size={16} />}
        </span>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}
