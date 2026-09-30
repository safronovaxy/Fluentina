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
 *
 * ADOPTION (KAN-52; Irina, 2026-09-29): sign-in adopts whatever guest essay the
 * browser is holding. Without it a guest who signs in loses sight of their
 * essay — `resolveOwnerActor` prefers the registered session, so the guest
 * cookie is never consulted and `essays.user_id` stays NULL — and since no
 * retention sweep exists the row is never deleted either. The fixation delete,
 * the adoption and the new session are ONE transaction (`signInUser`), the
 * session insert last, exactly as registration does it.
 *
 * What stays OUTSIDE that transaction: the user lookup, both scrypt
 * derivations (verify, and the rehash when due) and the rehash write. About
 * 90 ms of scrypt must not hold a pooled connection and the row locks
 * conversion takes. Only a verified login reaches the transaction at all.
 *
 * The conversion outcome is deliberately NOT on `LoginOutcome`:
 * `nothingToConvert` is also what retention deletion produces, so anything
 * counting it would mislabel a deleted session as a conversion (see
 * `GuestConversionOutcome`). Registration drops it for the same reason.
 */
import type { GuestSessionId, RegisteredSessionToken } from '@/lib/contracts/actor';
import type { LoginRequest } from '@/lib/contracts/auth';
import { findUserForLogin, replacePasswordHash, signInUser } from '@/lib/db/users';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { findPresentedSession } from './registered-session';

export interface LoginContext {
  /** The well-formed guest cookie value the request carried, if any. Never resolved (which would mint) — only offered to adoption. */
  readonly guestSessionId: GuestSessionId | null;
  /** The registered-session cookie value the request carried, if any — its row is deleted in the sign-in transaction. */
  readonly presentedSessionToken: RegisteredSessionToken | null;
}

export type LoginOutcome =
  | { readonly status: 'signedIn'; readonly token: RegisteredSessionToken }
  | { readonly status: 'invalidCredentials' };

export async function login(request: LoginRequest, context: LoginContext): Promise<LoginOutcome> {
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

  const presented = context.presentedSessionToken ? await findPresentedSession(context.presentedSessionToken) : null;

  const token = generateRegisteredSessionToken();
  await signInUser(actor, {
    guest: context.guestSessionId ? { kind: 'guest', sessionId: context.guestSessionId } : null,
    sessionTokenHash: hashRegisteredSessionToken(token),
    replacing: presented ? { actor: presented.actor, tokenHash: presented.tokenHash } : null,
  });
  // `guestConversion` is deliberately not surfaced — see this file's own comment.
  return { status: 'signedIn', token };
}
