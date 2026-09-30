import 'server-only';

/**
 * KAN-20 — the users repository: registration's one transaction, and the
 * login lookup. KAN-52 adds sign-in's one transaction (`signInUser`).
 */
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { users } from './schema';
import { insertConsentRecordsWithin, type ConsentDecision } from './consent-records';
import { convertGuestSessionToUserWithin } from './guest-sessions';
import { deleteSessionWithin, insertSessionWithin, sweepExpiredSessionsBestEffort } from './sessions';
import type { GuestActor, RegisteredSessionTokenHash, UserActor } from '@/lib/contracts/actor';
import type { NormalisedEmail } from '@/lib/contracts/auth';

export interface RegisterUserInput {
  readonly email: NormalisedEmail;
  /** Already hashed (lib/domain/password.ts) — never a password. Hashed BEFORE the transaction opens: ~90 ms of scrypt must not hold a connection and row locks. */
  readonly passwordHash: string;
  readonly consent: readonly ConsentDecision[];
  /** The guest whose session converts, if the request carried a well-formed guest cookie. */
  readonly guest: GuestActor | null;
  /** Hash of the freshly generated token for this registration's session. */
  readonly sessionTokenHash: RegisteredSessionTokenHash;
  /** A live session the request already carried, to delete in the same transaction (fixation). */
  readonly replacing: { readonly actor: UserActor; readonly tokenHash: RegisteredSessionTokenHash } | null;
}

export type RegisterUserResult =
  | { readonly status: 'registered'; readonly userId: string; readonly guestConversion: 'converted' | 'nothingToConvert' }
  | { readonly status: 'emailAlreadyRegistered' };

/**
 * SQLSTATE 23505 on the `users.email` unique constraint, and nothing else.
 * Detected by `code` plus `constraint`, reached through `.cause`, never by
 * parsing `detail` (the query-error sanitiser strips `detail` on purpose but
 * keeps `code` and `constraint`). Drizzle wraps every driver error in its own
 * `DrizzleQueryError` whose `code` is undefined — the SQLSTATE and constraint
 * live one level down, on `.cause` — the same two-level unwrap
 * `isUniqueViolation` does in lib/domain/guest-session.ts.
 *
 * Checking the constraint name, not just 23505, matters: a unique violation
 * on `sessions_pkey` (a token-hash collision) is not "that email is taken" and
 * must not be reported as such.
 */
export const USERS_EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

export function isEmailUniqueViolation(err: unknown): boolean {
  return matches(err) || matches(getCause(err));
}

function matches(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === '23505' &&
    'constraint' in err &&
    err.constraint === USERS_EMAIL_UNIQUE_CONSTRAINT
  );
}

function getCause(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'cause' in err ? err.cause : undefined;
}

/**
 * Registration, atomically: the user row, the consent rows, the guest
 * conversion and the login session commit together or not at all.
 *
 * ONE transaction, not four, because of the interleaving that hurts: the
 * conversion committing and the session insert then failing. The person has an
 * account they are not signed into, `essays.user_id` is set so `ownedBy`'s
 * guest branch (`isNull(userId)`) no longer matches their guest cookie, and
 * their essay is unreachable as either identity, permanently, with no error
 * explaining it. The session insert is deliberately the LAST statement, so a
 * failure there is the case that proves the rollback covers everything before
 * it. The caller sets its `Set-Cookie` only after this returns.
 *
 * Every step takes this transaction (`*Within`); none opens its own, because
 * `db.transaction` inside a transaction does not nest — it takes a different
 * pooled connection and runs a separate transaction.
 *
 * A duplicate email is an expected outcome, returned as a status. The catch
 * sits OUTSIDE `db.transaction`: the failed INSERT has already aborted the
 * transaction, which Drizzle rolls back before rethrowing. Any other error
 * still throws.
 */
export async function registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
  let result: { userId: string; guestConversion: 'converted' | 'nothingToConvert' };
  try {
    result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash: input.passwordHash })
        .returning({ id: users.id });

      await insertConsentRecordsWithin(tx, created.id, input.consent);

      const guestConversion = input.guest
        ? await convertGuestSessionToUserWithin(tx, input.guest, created.id)
        : 'nothingToConvert';

      if (input.replacing) {
        await deleteSessionWithin(tx, input.replacing.actor, input.replacing.tokenHash);
      }
      await insertSessionWithin(tx, { kind: 'user', userId: created.id }, input.sessionTokenHash);

      return { userId: created.id, guestConversion };
    });
  } catch (err) {
    if (isEmailUniqueViolation(err)) return { status: 'emailAlreadyRegistered' };
    throw err;
  }

  await sweepExpiredSessionsBestEffort();
  return { status: 'registered', ...result };
}

export interface SignInUserInput {
  /** The verified account — the caller has already checked the password. */
  readonly userId: string;
  /** The guest whose session and essays the account adopts, if the request carried a well-formed guest cookie. */
  readonly guest: GuestActor | null;
  /** Hash of the freshly generated token for this sign-in's session. */
  readonly sessionTokenHash: RegisteredSessionTokenHash;
  /** A live session the request already carried, to delete in the same transaction (fixation). */
  readonly replacing: { readonly actor: UserActor; readonly tokenHash: RegisteredSessionTokenHash } | null;
}

export interface SignInUserResult {
  readonly guestConversion: 'converted' | 'nothingToConvert';
}

/**
 * Sign-in, atomically: the fixation delete, the guest adoption and the new
 * login session commit together or not at all — `registerUser`'s shape, for
 * the same reason (Irina, 2026-09-29: sign-in adopts whatever guest essay the
 * browser is holding).
 *
 * Without adoption, a guest who signs in loses sight of their essay:
 * `resolveOwnerActor` prefers the registered session (correct — KAN-19), so the
 * guest cookie is never consulted and `essays.user_id` stays NULL. Nothing can
 * read the row, and no retention sweep exists to delete it.
 *
 * ONE transaction, and the session insert LAST, for the interleaving that
 * hurts: adoption committing and the session insert then failing. The person
 * has attached their essay to an account they are not signed into, the guest
 * cookie no longer authorises it (`session_id` is NULL now), and the response
 * is a 500 that tells them nothing about why their essay is gone. With the
 * session insert last, a failure there rolls the adoption back. A conversion
 * done as a second write AFTER the session is issued would leave the opposite
 * hole: a signed-in user whose adoption can fail silently.
 *
 * The caller has already done the ~90 ms of scrypt (verification, and the
 * rehash if due) BEFORE this: none of it may hold a pooled connection and the
 * row locks conversion takes. The expired-session sweep runs AFTER the commit,
 * outside the transaction, for the reason `sweepExpiredSessionsBestEffort`
 * gives: an error inside a transaction aborts it, so best-effort housekeeping
 * cannot live in here.
 *
 * `nothingToConvert` is returned but must never be counted as a conversion
 * metric — retention deletion produces it too (see `GuestConversionOutcome`).
 */
export async function signInUser(input: SignInUserInput): Promise<SignInUserResult> {
  const result = await db.transaction(async (tx) => {
    if (input.replacing) {
      await deleteSessionWithin(tx, input.replacing.actor, input.replacing.tokenHash);
    }

    const guestConversion = input.guest
      ? await convertGuestSessionToUserWithin(tx, input.guest, input.userId)
      : 'nothingToConvert';

    await insertSessionWithin(tx, { kind: 'user', userId: input.userId }, input.sessionTokenHash);

    return { guestConversion } as const;
  });

  await sweepExpiredSessionsBestEffort();
  return result;
}

export interface LoginCandidate {
  readonly id: string;
  readonly passwordHash: string;
}

/**
 * The login lookup, and one of the actor-first exceptions listed in
 * sessions.ts's header: it runs before there is any actor. It returns ONLY
 * the id and the password hash, on purpose — this is the one place the hash is
 * ever selected, and a login path must not be able to turn into a user-data
 * read by growing extra columns.
 */
export async function findUserForLogin(email: NormalisedEmail): Promise<LoginCandidate | null> {
  const [row] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  return row ?? null;
}

/**
 * Compare-and-swap of a user's password hash: writes `next` only if the
 * stored value is still `expected`. Used for rehash-on-login, where the update
 * must not clobber a hash a concurrent change wrote between the read and this
 * write. Returns whether it wrote.
 *
 * THIS IS THE ONLY FUNCTION THAT UPDATES `users.password_hash`, AND IT DOES NOT
 * REVOKE SESSIONS. That is correct for rehash-on-login, and only there: the
 * password did not change, only the cost parameters of its hash, so every
 * session minted under it is still legitimately held by the same person. A
 * GENUINE password change (a reset, a "change password" screen) is a different
 * operation and must, in the same transaction, delete every session for the
 * user — calling this and stopping leaves each session minted under the old
 * password authenticating for up to 30 days, including one held by whoever
 * made the reset necessary. No `deleteAllSessionsForUser` exists yet: the only
 * session deletes are the actor-scoped single-row `deleteSessionWithin` and the
 * expiry sweep. The story that changes passwords writes that primitive and its
 * own hash write with it, rather than reusing this one.
 */
export async function replacePasswordHash(actor: UserActor, expected: string, next: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ passwordHash: next })
    .where(and(eq(users.id, actor.userId), eq(users.passwordHash, expected)));
  return (result.rowCount ?? 0) > 0;
}
