import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Garde-fou : aucun fichier du bundle public ne doit importer Supabase ou le
// module d'auth (sinon une session/JWT pourrait fuiter côté destinataire).
const dir = fileURLToPath(new URL('.', import.meta.url));

describe('isolation du bundle public', () => {
  it('aucun import de supabase / auth', () => {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
      if (f.includes('.test.')) continue;
      const src = readFileSync(dir + f, 'utf-8');
      expect(src).not.toMatch(/@supabase\/supabase-js/);
      expect(src).not.toMatch(/lib\/supabase/);
      expect(src).not.toMatch(/lib\/auth/);
    }
  });
});
