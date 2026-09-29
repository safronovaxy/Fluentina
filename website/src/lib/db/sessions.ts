import 'server-only';

/**
 * KAN-20 — the registered-session repository.
 *
 * `sessions.id` is SHA-256 of the session token, never the token (see the
 * `sessions` table's comment in schema.ts for what that buys). Every function
 * here takes the HASH, typed as `RegisteredSessionTokenHash`, so a raw token
 * cannot be passed by mistake — the two are the same shape at runtime and are
 * kept apart only by their brands.
 *
 * The digest is PLAIN, UNSALTED SHA-256, and that is deliberate — do not
 * "fix" it to bcrypt, scrypt or a salted hash. The input is 256 bits of
 * uniform randomness, so there is no dictionary to defend against: a salt
 * would defend nothing and would make the lookup impossible (you cannot
 * index-seek on a value you cannot recompute without the per-row salt), and a
 * KDF would put ~100 ms of CPU on every authenticated request. The lookup must
 * be one indexed equality. Password hashing is a different problem — low-
 * entropy input — and does use scrypt (lib/domain/password.ts).
 *
 * ACTOR-FIRST, WITH ONE EXCEPTION. Every function here takes a `UserActor`
 * and scopes on `user_id`, except `findLiveSessionUserId`: it is the function
 * that PRODUCES a `UserActor` from a cookie, so it cannot take one. It is not
 * fudged with a `SystemActor` — lib/contracts/actor.ts is explicit that no
 * such escape hatch exists — and it is named so that the exception is
 * greppable. The exception is one function wide.
 */
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db, type Executor } from './client';
import { sessions } from './schema';
import type { RegisteredSessionTokenHash, UserActor } from '@/lib/contracts/actor';
import {
  SESSION_ABSOLUTE_LIFETIME_DAYS,
  SESSION_IDLE_TIMEOUT_DAYS,
  SESSION_LAST_USED_REFRESH_HOURS,
} from '@/lib/contracts/session-policy';

export interface LiveSession {
  readonly userId: string;
  readonly lastUsedAt: Date;
}

/**
 * THE ACTOR-FIRST EXCEPTION: resolves a token hash to the user it
 * authenticates, or null. Takes no actor because it is how an actor comes to
 * exist.
 *
 * Both expiry conditions — the absolute `expires_at` and the idle timeout on
 * `last_used_at` — are in the SAME `WHERE` as the id match, evaluated by
 * Postgres against its own clock, not filtered in JavaScript after the row
 * has been read. A row that fails either is indistinguishable from one that
 * does not exist.
 *
 * Returns `lastUsedAt` so the caller can decide whether a refresh is due
 * without a second round trip on every request.
 */
export async function findLiveSessionUserId(tokenHash: RegisteredSessionTokenHash): Promise<LiveSession | null> {
  const [row] = await db
    .select({ userId: sessions.userId, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, tokenHash),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.lastUsedAt, sql`now() - make_interval(days => ${SESSION_IDLE_TIMEOUT_DAYS})`),
      ),
    );
  return row ?? null;
}

/**
 * Inserts a fresh session row. ALWAYS an INSERT with a freshly generated
 * token's hash — never an UPDATE that promotes an existing row by attaching a
 * `user_id`. That is the session-fixation rule: a credential that existed
 * before authentication is never the one that carries the authenticated
 * session.
 *
 * Takes the caller's `Executor` so registration can include it in the one
 * transaction with the user, the consent rows and the guest conversion. Does
 * NOT sweep: an error inside a transaction aborts it, so a best-effort sweep
 * cannot live in here — see `sweepExpiredSessions`.
 *
 * `expires_at` is computed by Postgres (`now() + 30 days`), the same clock
 * the lookup compares it against.
 */
export async function insertSessionWithin(
  executor: Executor,
  actor: UserActor,
  tokenHash: RegisteredSessionTokenHash,
): Promise<void> {
  await executor.insert(sessions).values({
    id: tokenHash,
    userId: actor.userId,
    expiresAt: sql`now() + make_interval(days => ${SESSION_ABSOLUTE_LIFETIME_DAYS})`,
  });
}

/**
 * Deletes one of `actor`'s own sessions. Scoped on `user_id` as well as the
 * id, so holding another user's token hash deletes nothing. Returns whether a
 * row was deleted.
 *
 * Logout is this, followed by clearing the cookie — clearing only the cookie
 * would leave a live credential in the database and throw away the whole
 * reason sessions live in a table.
 */
export async function deleteSessionWithin(
  executor: Executor,
  actor: UserActor,
  tokenHash: RegisteredSessionTokenHash,
): Promise<boolean> {
  const result = await executor
    .delete(sessions)
    .where(and(eq(sessions.id, tokenHash), eq(sessions.userId, actor.userId)));
  return (result.rowCount ?? 0) > 0;
}

/** `deleteSessionWithin` on its own connection, for logout and the sign-in path. */
export async function deleteSession(actor: UserActor, tokenHash: RegisteredSessionTokenHash): Promise<boolean> {
  return deleteSessionWithin(db, actor, tokenHash);
}

/**
 * Marks a session as used now — but only if it is more than an hour stale, in
 * the WHERE, so a burst of concurrent requests produces one write between
 * them rather than one each.
 */
export async function touchSession(actor: UserActor, tokenHash: RegisteredSessionTokenHash): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, tokenHash),
        eq(sessions.userId, actor.userId),
        lt(sessions.lastUsedAt, sql`now() - make_interval(hours => ${SESSION_LAST_USED_REFRESH_HOURS})`),
      ),
    );
}

/**
 * Deletes every session past its absolute expiry. Hung off session CREATION
 * (sign-in, registration), not off reads: creation is rare, reads are hot, and
 * correctness never depends on this running because the lookup filters on
 * expiry anyway.
 *
 * Inherits `rate_limit_counters`' caveat verbatim: on a scale-to-zero service
 * this bounds growth, it does not bound it to a fixed interval. Expired rows
 * wait for the next creation that lands on an instance. A scheduled sweep
 * would close that gap and is not built here — see the `sessions` table's
 * comment.
 *
 * Idle-expired rows are not swept by this (the index is on `expires_at`); they
 * age out with their absolute expiry, at most 30 days after creation.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
  return result.rowCount ?? 0;
}

/**
 * `sweepExpiredSessions` that can never fail the caller: the sweep is
 * housekeeping hung off a sign-in that has already succeeded, and an
 * unavailable sweep must not turn that sign-in into an error. Logs a fixed
 * event name only — nothing about the failure's content.
 */
export async function sweepExpiredSessionsBestEffort(): Promise<void> {
  try {
    await sweepExpiredSessions();
  } catch {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'session_sweep_failed' }));
  }
}

/**
 * Standalone session creation for the sign-in path (registration inserts
 * through `insertSessionWithin` inside its own transaction instead): insert,
 * then sweep.
 */
export async function createSession(actor: UserActor, tokenHash: RegisteredSessionTokenHash): Promise<void> {
  await insertSessionWithin(db, actor, tokenHash);
  await sweepExpiredSessionsBestEffort();
}
