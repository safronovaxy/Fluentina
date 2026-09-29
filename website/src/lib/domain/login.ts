import 'server-only';

/**
 * KAN-20 — password login.
 *
 * ONE scrypt verification on EVERY path, including an unknown email: with no
 * such user, the password is verified against `DUMMY_PASSWORD_HASH` and the
 * result discarded. Same status (401), same `invalidCredentials` reason and
 * message for "no such user" and "wrong password", and both rate-limit counters
 * increment identically (`checkLoginRateLimit`, run by the route before this).
 * Without the dummy verification the unknown-email path would skip ~90 ms of
 * scrypt and be trivially distinguishable from a wrong password by response
 * time.
 *
 * What this does NOT claim: constant time. A hit does one more index lookup
 * (the sessions insert, and the CAS rehash when parameters are stale) than a
 * miss, which is sub-millisecond against ~91 ms of scrypt. The claim is that
 * the oracle is not usable, not that no difference exists.
 *
 * REHASH: on a SUCCESSFUL login whose stored hash carries parameters other than
 * the current ones, the password is hashed again with the current parameters
 * and the row updated in place (compare-and-swap on the old hash). That is a
 * second scrypt derivation, on the success path only — it is a hash, not a
 * verification, and only the person who just proved they know the password
 * pays for it. Failure to rehash never fails the login.
 *
 * FIXATION: a fresh row with a fresh token, always. If the request already
 * carried a live session, that row is deleted first; an existing row is never
 * promoted by attaching a user.
 */
import type { RegisteredSessionToken } from '@/lib/contracts/actor';
import type { LoginRequest } from '@/lib/contracts/auth';
import { findUserForLogin, replacePasswordHash } from '@/lib/db/users';
import { createSession, deleteSession } from '@/lib/db/sessions';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { findPresentedSession } from './registered-session';

export type LoginOutcome =
  | { readonly status: 'signedIn'; readonly token: RegisteredSessionToken }
  | { readonly status: 'invalidCredentials' };

export async function login(request: LoginRequest, presentedSessionToken: RegisteredSessionToken | null): Promise<LoginOutcome> {
  const candidate = await findUserForLogin(request.email);

  // Exactly one derivation, whichever branch: the user's own hash, or the
  // dummy. The dummy's result is computed and thrown away — `candidate` alone
  // decides whether this account exists.
  const verification = await verifyPassword(request.password, candidate?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (candidate === null || !verification.valid) return { status: 'invalidCredentials' };

  const actor = { kind: 'user', userId: candidate.id } as const;

  if (verification.needsRehash) {
    try {
      await replacePasswordHash(actor, candidate.passwordHash, await hashPassword(request.password));
    } catch {
      console.warn(JSON.stringify({ severity: 'WARNING', event: 'password_rehash_failed' }));
    }
  }

  if (presentedSessionToken) {
    const presented = await findPresentedSession(presentedSessionToken);
    if (presented) await deleteSession(presented.actor, presented.tokenHash);
  }

  const token = generateRegisteredSessionToken();
  await createSession(actor, hashRegisteredSessionToken(token));
  return { status: 'signedIn', token };
}
