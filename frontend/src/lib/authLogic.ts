// ============================================================
// Réelgram — pure auth logic (no React, no browser APIs)
// Unit-tested in isolation (authLogic.test.ts, vitest).
// cf. docs/superpowers/specs/2026-06-07-reelgram-04-auth.md §3,§5
// ============================================================

/**
 * Where the gate should land the user:
 * - `email`     → not signed in: show the email/password form.
 * - `biometric` → signed in AND a Face ID credential is enrolled on this
 *                 device: app stays locked until biometric unlock.
 * - `enter`     → signed in, no biometric lock: go straight into the library.
 */
export type AuthMode = 'email' | 'biometric' | 'enter';

export interface AuthDecisionInput {
  hasSession: boolean;
  biometricEnrolled: boolean;
}

export function decideAuthMode({ hasSession, biometricEnrolled }: AuthDecisionInput): AuthMode {
  if (!hasSession) return 'email';
  return biometricEnrolled ? 'biometric' : 'enter';
}

/** Loose shape of a Supabase / generic error — only `message` is read. */
export interface AuthErrorLike {
  message?: string | null;
}

const FALLBACK = 'Une erreur est survenue. Réessaie.';

/**
 * Maps a Supabase auth error to a short, user-facing French message.
 * Null-safe: any falsy / unknown input yields the generic fallback.
 */
export function mapAuthError(err: AuthErrorLike | null | undefined): string {
  const message = err?.message;
  if (!message) return FALLBACK;

  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
  if (m.includes('user already registered')) return 'Un compte existe déjà avec cet email.';
  if (m.includes('email not confirmed')) return 'Confirme ton email avant de te connecter.';
  if (m.includes('password should be at least')) return 'Mot de passe trop court (6 caractères minimum).';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Adresse email invalide.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessaie dans un instant.';

  return FALLBACK;
}
