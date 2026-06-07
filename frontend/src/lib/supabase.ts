// ============================================================
// Réelgram — Supabase client (singleton)
// Public anon key + URL come from runtime config (window.__ENV__),
// never hardcoded. cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §6
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { config } from './config';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
