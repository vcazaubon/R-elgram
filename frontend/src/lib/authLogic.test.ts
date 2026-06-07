import { describe, it, expect } from 'vitest';
import { decideAuthMode, mapAuthError } from './authLogic';

describe('decideAuthMode', () => {
  it('no session -> email', () => {
    expect(decideAuthMode({ hasSession: false, biometricEnrolled: false })).toBe('email');
    expect(decideAuthMode({ hasSession: false, biometricEnrolled: true })).toBe('email');
  });
  it('session + biometric enrolled -> biometric lock', () => {
    expect(decideAuthMode({ hasSession: true, biometricEnrolled: true })).toBe('biometric');
  });
  it('session + no biometric -> enter', () => {
    expect(decideAuthMode({ hasSession: true, biometricEnrolled: false })).toBe('enter');
  });
});

describe('mapAuthError', () => {
  it('maps invalid credentials to FR', () => {
    expect(mapAuthError({ message: 'Invalid login credentials' })).toMatch(/incorrect|invalide/i);
  });
  it('fallback for unknown', () => {
    expect(mapAuthError({ message: 'weird' })).toBeTruthy();
  });
  it('handles null', () => {
    expect(mapAuthError(null)).toBeTruthy();
  });
});
