// ============================================================
// Réelgram — runtime config
// Reads window.__ENV__ (injected by /env.js before the bundle) with
// dev fallbacks. cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §6
// ============================================================

export interface ReelgramEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  API_URL: string;
  ALLOW_SIGNUPS: string;
}

declare global {
  interface Window {
    __ENV__?: Partial<ReelgramEnv>;
    __REELGRAM_PWA?: boolean;
  }
}

const env: Partial<ReelgramEnv> = window.__ENV__ ?? {};

export const config = {
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
  apiUrl: env.API_URL ?? '/api',
  allowSignups: (env.ALLOW_SIGNUPS ?? 'true') === 'true',
} as const;

// Mark this build as the installable PWA shell: the StatusBar collapses to a
// safe-area spacer so the REAL device status bar shows through.
window.__REELGRAM_PWA = true;
