// ============================================================
// Réelgram — DEV runtime config generator
// Writes frontend/public/env.js from the repo-root .env, mirroring what
// docker-entrypoint.sh does from the container environment in production.
// Only PUBLIC values (Supabase URL + publishable anon key) end up in env.js.
//
// public/env.js is marked `git update-index --skip-worktree`, so the values
// generated here stay LOCAL and never get committed/pushed — the tracked
// placeholder in the repo stays empty.
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';

const envPath = new URL('../../.env', import.meta.url);   // -> repo-root /.env
const outPath = new URL('../public/env.js', import.meta.url);

let raw;
try {
  raw = readFileSync(envPath, 'utf8');
} catch {
  console.error(`[gen-env-dev] cannot read ${envPath.pathname} — dev config not generated`);
  process.exit(1);
}

// Parse simple KEY=VALUE lines (skip blanks and # comments). Per .env's own
// note, values must NOT carry an inline "# comment", so we take the rest of
// the line verbatim and only trim surrounding whitespace.
const env = {};
for (const line of raw.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const SUPABASE_URL = env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY ?? '';
const API_URL = env.API_URL || '/api';
const ALLOW_SIGNUPS = env.ALLOW_SIGNUPS || 'true';

// Fail loudly with a clear message instead of letting the browser throw the
// cryptic "supabaseUrl is required" deep inside @supabase/supabase-js.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[gen-env-dev] SUPABASE_URL / SUPABASE_ANON_KEY missing in .env — fill them in /opt/Réelgram/.env');
  process.exit(1);
}

const body = `// GENERATED for dev by scripts/gen-env-dev.mjs from repo-root .env — do not edit by hand.
// Local only (skip-worktree). In production docker-entrypoint.sh regenerates this.
window.__ENV__ = {
  SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)},
  SUPABASE_ANON_KEY: ${JSON.stringify(SUPABASE_ANON_KEY)},
  API_URL: ${JSON.stringify(API_URL)},
  ALLOW_SIGNUPS: ${JSON.stringify(ALLOW_SIGNUPS)},
};
`;
writeFileSync(outPath, body);
console.log(`[gen-env-dev] wrote ${outPath.pathname} (SUPABASE_URL=${SUPABASE_URL})`);
