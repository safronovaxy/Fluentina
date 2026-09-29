import { describe, expect, it } from 'vitest';
import {
  REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS,
  REGISTERED_SESSION_COOKIE_NAME,
  REGISTERED_SESSION_COOKIE_OPTIONS,
} from './registered-session-cookie';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from './guest-session-cookie';
import { SESSION_ABSOLUTE_LIFETIME_DAYS, SESSION_IDLE_TIMEOUT_DAYS } from './contracts/session-policy';

const DAY_SECONDS = 24 * 60 * 60;

describe('the registered-session cookie', () => {
  it('is __Host- prefixed and a different cookie from the guest one', () => {
    expect(REGISTERED_SESSION_COOKIE_NAME).toBe('__Host-fluentina_session');
    expect(REGISTERED_SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(REGISTERED_SESSION_COOKIE_NAME).not.toBe(GUEST_SESSION_COOKIE_NAME);
  });

  it('carries the guest cookie\'s four non-lifetime attributes: httpOnly, secure, Lax, Path=/ — the __Host- preconditions', () => {
    const { maxAge: _registered, ...registered } = REGISTERED_SESSION_COOKIE_OPTIONS;
    const { maxAge: _guest, ...guest } = GUEST_SESSION_COOKIE_OPTIONS;
    expect(registered).toEqual(guest);
    expect(registered).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  });

  it('is SameSite=Lax, not Strict — Strict would break landing signed in from the verification link (KAN-51)', () => {
    expect(REGISTERED_SESSION_COOKIE_OPTIONS.sameSite).toBe('lax');
  });

  it('lives 14 days — the idle timeout — and never longer than the row\'s 30-day absolute expiry', () => {
    expect(REGISTERED_SESSION_COOKIE_OPTIONS.maxAge).toBe(14 * DAY_SECONDS);
    expect(REGISTERED_SESSION_COOKIE_OPTIONS.maxAge).toBe(SESSION_IDLE_TIMEOUT_DAYS * DAY_SECONDS);
    expect(REGISTERED_SESSION_COOKIE_OPTIONS.maxAge).toBeLessThanOrEqual(SESSION_ABSOLUTE_LIFETIME_DAYS * DAY_SECONDS);
  });

  it('has a lifetime independent of the guest cookie\'s: they are different decisions', () => {
    expect(REGISTERED_SESSION_COOKIE_OPTIONS.maxAge).not.toBe(GUEST_SESSION_COOKIE_OPTIONS.maxAge);
  });

  it('clears with IDENTICAL attributes and maxAge 0 — a __Host- cookie is not cleared by a delete that omits Secure or Path=/', () => {
    // A literal, not `{ ...REGISTERED_SESSION_COOKIE_OPTIONS, maxAge: 0 }`: that
    // is the source's own definition restated, and could not fail.
    expect(REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    // ...and it stays in step with the options it clears, whatever they become.
    const { maxAge: _set, ...setAttributes } = REGISTERED_SESSION_COOKIE_OPTIONS;
    const { maxAge: _cleared, ...clearAttributes } = REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS;
    expect(clearAttributes).toEqual(setAttributes);
  });
});
