import { describe, it, expect } from 'vitest';
import { EXPIRY_OPTIONS, statusBadge, formatExpiry } from './shareLogic';
import type { ShareInfo } from './types';

const base: ShareInfo = {
  id: 's', slug: 'a', url: 'u', status: 'active', expires_at: null,
  has_password: false, view_count: 0, created_at: '2026-06-12T00:00:00Z',
};

describe('EXPIRY_OPTIONS', () => {
  it('propose 24h/7d/30d/permanent avec la valeur API', () => {
    expect(EXPIRY_OPTIONS.map((o) => o.value)).toEqual(['24h', '7d', '30d', null]);
  });
});

describe('statusBadge', () => {
  it('permanent actif → libellé Permanent', () => {
    expect(statusBadge({ ...base, status: 'active', expires_at: null }).label).toBe('Permanent');
  });
  it('expiré → rouge', () => {
    expect(statusBadge({ ...base, status: 'expired' }).label).toBe('Expiré');
  });
  it('révoqué → libellé Révoqué', () => {
    expect(statusBadge({ ...base, status: 'revoked' }).label).toBe('Révoqué');
  });
  it('actif daté → "Expire dans …"', () => {
    const soon = new Date(Date.now() + 18 * 3600 * 1000).toISOString();
    expect(statusBadge({ ...base, status: 'active', expires_at: soon }).label).toMatch(/Expire/);
  });
});

describe('formatExpiry', () => {
  it('null → permanent', () => {
    expect(formatExpiry(null)).toMatch(/permanent/i);
  });
});
