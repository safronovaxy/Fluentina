/**
 * The registered-session cookie's name and Set-Cookie attributes (KAN-20).
 *
 * A separate module from `guest-session-cookie.ts`, deliberately: the guest
 * cookie lives 30 days, this one lives 14, and they are different decisions
 * that must not be coupled by a shared constant. Plain adapter-level code, not
 * `lib/domain` (ADR-14 — cookie mechanisms are a framework concern); the NAME
 * is imported by `lib/domain/registered-session.ts` the same way the guest
 * cookie's is by `owner-actor.ts`, so there is one definition of it.
 *
 * The session token is a bearer credential; the five attributes are the guest
 * cookie's, for the reasons written out in `guest-session-cookie.ts` (read that
 * comment rather than re-deriving them here):
 * - `__Host-` prefix: the browser refuses it unless `Secure`, host-only and
 *   `Path=/`, closing the sibling-subdomain planting route to session
 *   fixation.
 * - `httpOnly`: never readable from `document.cookie`.
 * - `secure`: never sent over plain HTTP (browsers still honour it on
 *   `localhost`).
 * - `path: '/'`: `__Host-` requires it.
 * - `maxAge`: 14 days, the idle timeout — the row's absolute expiry is 30
 *   days, and the cookie is never allowed to outlive it
 *   (`registered-session-cookie.test.ts` pins that).
 *
 * `sameSite: 'lax'`, not `'strict'`, because Strict would break "click the
 * verification link in the email and land signed in" (KAN-51). THE COST OF
 * LAX, which nothing enforces: Lax cookies ARE sent on top-level cross-site
 * GET navigations. So every state-changing endpoint must stay a POST — a
 * state-changing GET would be CSRF-able by a plain link. They all are POST
 * today (`/api/auth/register`, `/login`, `/logout`). Do not add one that is
 * not.
 *
 * CLEARING: to remove this cookie send it again with these SAME attributes and
 * `maxAge: 0`. A `__Host-` cookie is not cleared by a delete that omits
 * `Secure` or `Path=/` — the browser rejects the header as a `__Host-` cookie
 * violating its own preconditions, and the old cookie stays. That is what
 * `REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS` is for.
 */
import { SESSION_IDLE_TIMEOUT_DAYS } from '@/lib/contracts/session-policy';

export const REGISTERED_SESSION_COOKIE_NAME = '__Host-fluentina_session';

export const REGISTERED_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60,
} as const;

export const REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS = {
  ...REGISTERED_SESSION_COOKIE_OPTIONS,
  maxAge: 0,
} as const;
