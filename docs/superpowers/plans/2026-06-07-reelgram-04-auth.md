# Réelgram Spec 04 — Auth (email/mdp + Face ID WebAuthn) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD sur la logique pure (vitest) ; gate global tsc strict + build. Steps en `- [ ]`.

**Goal:** Authentification email+mot de passe (Supabase Auth) + couche Face ID (WebAuthn, verrou biométrique local par-dessus la session) + route guard + isolation multi-user. Visuel LoginScreen pixel-perfect conservé.

**Architecture:** `AuthProvider` (contexte session Supabase). Logique de décision du guard et mapping d'erreurs extraits en **fonctions pures testées (vitest)**. WebAuthn isolé dans `biometric.ts` (feature-detection, jamais bloquant). LoginScreen garde le visuel du proto, remplace les actions par email+pwd + bouton Face ID conditionnel.

**Tech Stack:** @supabase/supabase-js (déjà présent), WebAuthn API navigateur, vitest (nouveau, dev).

---

## File Structure
- `frontend/src/lib/supabase.ts` — client.
- `frontend/src/lib/authLogic.ts` — fonctions PURES : `decideAuthMode(state)`, `mapAuthError(err)`. (testables)
- `frontend/src/lib/auth.tsx` — `AuthProvider` + `useAuth`.
- `frontend/src/lib/biometric.ts` — WebAuthn (availability/enroll/unlock/clear), défensif.
- `frontend/src/screens/LoginScreen.tsx` — réécrit (email+pwd + Face ID).
- `frontend/src/App.tsx` — guard.
- `frontend/src/lib/authLogic.test.ts` — vitest.
- `frontend/vitest.config.ts` + scripts package.json.

---

## Task 1: Logique pure du guard + mapping erreurs (TDD vitest)
**Files:** Create `frontend/src/lib/authLogic.ts`, `frontend/src/lib/authLogic.test.ts`, `frontend/vitest.config.ts`; Modify `frontend/package.json`

- [ ] **Step 1:** `npm i -D vitest`. Ajouter script `"test": "vitest run"`. `vitest.config.ts` minimal (environment node).
- [ ] **Step 2: test (rouge)** `authLogic.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { decideAuthMode, mapAuthError } from './authLogic';
describe('decideAuthMode', () => {
  it('no session -> email', () => {
    expect(decideAuthMode({hasSession:false, biometricEnrolled:false})).toBe('email');
    expect(decideAuthMode({hasSession:false, biometricEnrolled:true})).toBe('email');
  });
  it('session + biometric enrolled -> biometric lock', () => {
    expect(decideAuthMode({hasSession:true, biometricEnrolled:true})).toBe('biometric');
  });
  it('session + no biometric -> enter', () => {
    expect(decideAuthMode({hasSession:true, biometricEnrolled:false})).toBe('enter');
  });
});
describe('mapAuthError', () => {
  it('maps invalid credentials to FR', () => {
    expect(mapAuthError({message:'Invalid login credentials'})).toMatch(/incorrect|invalide/i);
  });
  it('fallback for unknown', () => {
    expect(mapAuthError({message:'weird'})).toBeTruthy();
  });
  it('handles null', () => { expect(mapAuthError(null)).toBeTruthy(); });
});
```
- [ ] **Step 3: run rouge** `cd frontend && npx vitest run src/lib/authLogic.test.ts` → FAIL (module manquant).
- [ ] **Step 4:** `authLogic.ts` : `type AuthMode='email'|'biometric'|'enter'` ; `decideAuthMode({hasSession,biometricEnrolled})` (pas de session→'email' ; session+enrolled→'biometric' ; session+!enrolled→'enter') ; `mapAuthError(err)` → message FR court (Invalid login credentials→"Email ou mot de passe incorrect.", User already registered→"Un compte existe déjà avec cet email.", défaut→"Une erreur est survenue. Réessaie.", null-safe).
- [ ] **Step 5: run vert** `npx vitest run src/lib/authLogic.test.ts` → PASS. **Commit** "Spec 04 T1: logique guard + mapping erreurs (vitest)".

## Task 2: Supabase client + AuthProvider
**Files:** Create `frontend/src/lib/supabase.ts`, `frontend/src/lib/auth.tsx`
- [ ] **Step 1:** `supabase.ts` : `createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true}})`.
- [ ] **Step 2:** `auth.tsx` : `AuthProvider` + `useAuth` → `{session,user,loading,signIn(email,pwd),signUp(email,pwd),signOut(),getAccessToken()}`. Bootstrap `getSession()` + `onAuthStateChange` (cleanup). `signIn/signUp` renvoient `{error}` (message via mapAuthError côté écran).
- [ ] **Step 3: Gate** `npx tsc --noEmit && npm run build` → 0 erreur. **Commit** "Spec 04 T2: supabase client + AuthProvider".

## Task 3: biometric WebAuthn (défensif)
**Files:** Create `frontend/src/lib/biometric.ts`
- [ ] **Step 1:** `isBiometricAvailable()` (`window.PublicKeyCredential && isUserVerifyingPlatformAuthenticatorAvailable()`, try/catch→false) ; `isBiometricEnrolled(userKey)` (localStorage) ; `enrollBiometric(userKey)` (`navigator.credentials.create`, platform, userVerification required, stocke credentialId b64url, try/catch→false) ; `unlockBiometric(userKey)` (`navigator.credentials.get`, try/catch→false) ; `clearBiometric(userKey)`. userKey = `u:${user.id}`. JAMAIS d'exception propagée.
- [ ] **Step 2: Gate** `npx tsc --noEmit && npm run build` → 0 erreur. **Commit** "Spec 04 T3: couche Face ID WebAuthn défensive".

## Task 4: LoginScreen (email+pwd + Face ID) + App guard
**Files:** Modify `frontend/src/screens/LoginScreen.tsx`, `frontend/src/App.tsx`
- [ ] **Step 1: LoginScreen** — GARDER tout le visuel premium (brand, glow, dégradé, spinner, microcopy). Remplacer actions par : champ email + champ mot de passe + toggle « Créer un compte / Se connecter » (signup masqué si `config.ALLOW_SIGNUPS==='false'`/false). Loading=spinner proto. Erreur sous le champ (ton #ff8a96) via `mapAuthError`. Si mode verrou biométrique (prop) : bouton « Déverrouiller avec Face ID » (glyph existant) + fallback « Utiliser le mot de passe ». Bouton Apple : masqué. Succès → `onEnter`.
- [ ] **Step 2: App.tsx** — wrap dans `AuthProvider`. Au boot (session connue) : `decideAuthMode` → 'email' (login form) | 'biometric' (login verrouillé, unlock via Face ID) | 'enter' (route library). Après 1ʳᵉ connexion sans biométrie enrôlée et si `isBiometricAvailable()` : proposer enrôlement (sheet simple). `signOut` → clearBiometric + purge + login. LoginScreen reste seule route tant que non authentifié/déverrouillé.
- [ ] **Step 3: Gate** `npx vitest run && npx tsc --noEmit && npm run build` → tout vert. **Commit** "Spec 04 T4: LoginScreen email/mdp + Face ID + guard".

---

## Self-Review
- **Spec coverage :** supabase client (T2) ✓ · AuthProvider (T2) ✓ · biometric WebAuthn défensif (T3) ✓ · LoginScreen email/mdp+FaceID+toggle+ALLOW_SIGNUPS (T4) ✓ · guard 3 cas (T1 logique + T4 câblage) ✓ · isolation = RLS (rien de plus côté front, supabase-js attache le JWT) ✓ · fallback WebAuthn indispo (T3 try/catch + T4) ✓.
- **Placeholders :** tests fournis ; impl décrite précisément. Pas de TODO.
- **Type consistency :** `AuthMode` cohérent T1↔T4 ; `useAuth` signatures T2↔T4 ; userKey `u:${id}` T3.
