// ============================================================
// Réelgram — Face ID / biometric lock (WebAuthn, platform authenticator)
// LOCAL lock layered over an already-valid Supabase session — NOT a
// Supabase provider. No server verification: the goal is to gate local
// access to a persisted session on the installed PWA.
//
// HARD RULE: this module never propagates an exception. Every browser
// call is wrapped; failures resolve to false/null so the email/password
// flow always keeps working, even on browsers without WebAuthn.
// cf. docs/superpowers/specs/2026-06-07-reelgram-04-auth.md §4
// ============================================================

const STORE_PREFIX = 'reelgram.bio:';

/** localStorage key for a given user. userKey is `u:${user.id}`. */
function storeKey(userKey: string): string {
  return STORE_PREFIX + userKey;
}

// ---- base64url helpers (defensive) ----------------------------------------

function bufferToB64url(buf: ArrayBuffer): string {
  try {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

function b64urlToBuffer(value: string): ArrayBuffer | null {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return buf;
  } catch {
    return null;
  }
}

// Returns a Uint8Array explicitly backed by an ArrayBuffer (not the wider
// ArrayBufferLike), so it satisfies WebAuthn's BufferSource parameters under
// strict lib typing.
function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(len);
  const arr = new Uint8Array(buf);
  try {
    crypto.getRandomValues(arr);
  } catch {
    // Extremely unlikely (no WebCrypto). Fill with non-zero pseudo bytes;
    // this challenge is never verified server-side anyway.
    for (let i = 0; i < len; i++) arr[i] = (i * 31 + 7) & 0xff;
  }
  return arr;
}

// ---- availability ----------------------------------------------------------

/**
 * True only if WebAuthn AND a user-verifying platform authenticator
 * (Face ID / Touch ID / Windows Hello) are available. Any error → false.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    const PKC = window.PublicKeyCredential;
    if (!PKC || typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      return false;
    }
    return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---- enrolment state -------------------------------------------------------

/** Synchronous local check: is a credential stored for this user? */
export function isBiometricEnrolled(userKey: string): boolean {
  try {
    return !!localStorage.getItem(storeKey(userKey));
  } catch {
    return false;
  }
}

function readCredentialId(userKey: string): string | null {
  try {
    return localStorage.getItem(storeKey(userKey));
  } catch {
    return null;
  }
}

// ---- enrolment -------------------------------------------------------------

/**
 * Create a platform credential and persist its id (base64url) for this user.
 * Returns true on success, false on any failure / cancellation.
 */
export async function enrollBiometric(userKey: string): Promise<boolean> {
  try {
    if (!(await isBiometricAvailable())) return false;
    if (typeof navigator === 'undefined' || !navigator.credentials) return false;

    const userId = randomBytes(16);
    const created = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Réelgram' },
        user: {
          id: userId,
          name: userKey,
          displayName: 'Réelgram',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });

    const cred = created as PublicKeyCredential | null;
    if (!cred || !cred.rawId) return false;

    const id = bufferToB64url(cred.rawId);
    if (!id) return false;

    localStorage.setItem(storeKey(userKey), id);
    return true;
  } catch {
    return false;
  }
}

// ---- unlock ----------------------------------------------------------------

/**
 * Prompt the platform authenticator for the stored credential.
 * Returns true on a successful user verification, false otherwise.
 * The assertion is NOT verified server-side — success simply lifts the lock.
 */
export async function unlockBiometric(userKey: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.credentials) return false;

    const storedId = readCredentialId(userKey);
    if (!storedId) return false;

    const rawId = b64urlToBuffer(storedId);
    if (!rawId) return false;

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch {
    return false;
  }
}

// ---- teardown --------------------------------------------------------------

/** Remove the local credential mapping (called on sign out). Never throws. */
export function clearBiometric(userKey: string): void {
  try {
    localStorage.removeItem(storeKey(userKey));
  } catch {
    /* ignore */
  }
}
