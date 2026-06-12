// frontend/src/lib/shareLogic.ts
// Logique pure des liens de partage (aucune dépendance React / réseau).
import type { ShareExpiresIn, ShareInfo } from './types';

export interface ExpiryOption {
  value: ShareExpiresIn;
  label: string;
}

/** Presets exposés dans le sheet (ordre d'affichage). Défaut = 7 jours (index 1). */
export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: null, label: 'Permanent' },
];

export const DEFAULT_EXPIRY: ShareExpiresIn = '7d';

export interface Badge {
  label: string;
  color: string;
}

const VIOLET = '#a78bfa';
const GREEN = '#5ee2a0';
const AMBER = '#ff9966';
const RED = '#ff8a96';

function relativeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expiré';
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `Expire ${h} h`;
  return `Expire ${Math.round(h / 24)} j`;
}

/** Pastille de statut (libellé + couleur), cohérente partout. */
export function statusBadge(s: ShareInfo): Badge {
  if (s.status === 'revoked') return { label: 'Révoqué', color: RED };
  if (s.status === 'expired') return { label: 'Expiré', color: RED };
  if (s.expires_at === null) return { label: 'Permanent', color: VIOLET };
  const ms = new Date(s.expires_at).getTime() - Date.now();
  const color = ms < 24 * 3_600_000 ? AMBER : GREEN;
  return { label: relativeFromNow(s.expires_at), color };
}

/** Résumé d'expiration pour l'état « lien prêt ». */
export function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Lien permanent';
  const d = new Date(expiresAt);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Expire le ${date}`;
}
