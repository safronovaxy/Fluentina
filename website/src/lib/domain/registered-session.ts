import 'server-only';

/**
 * The registered-user half of "who is asking": turns the session cookie's
 * value into a `UserActor`, or null.
 *
 * KAN-20 replaced the body of the stub that used to sit here; the signature is
 * unchanged, so `resolveOwnerActor` and both of its call sites did not move.
 * It stays its own module, not a local function of `owner-actor.ts`, so a test
 * can stand a registered session in front of the resolver — the order in
 * `resolveOwnerActor` (registered first, guest as fallback) matters and is
 * only observable while a registered session can be made to exist.
 *
 * Three test files `vi.mock` this module and keep returning their stub after
 * the real lookup exists, so they stay green whether or not it works —
 * `app/api/essays/[id]/grading/route.test.ts`,
 * `app/[locale]/(guest)/practice/preview/page.test.tsx` and
 * `lib/domain/owner-actor.test.ts`. The real lookup is covered here, in
 * `registered-session.test.ts`, not by leaning on those.
 *
 * `async` because the lookup is a `sessions` row read.
 */
import { registeredSessionTokenSchema, type RegisteredSessionToken, type RegisteredSessionTokenHash, type UserActor } from '@/lib/contracts/actor';
import { SESSION_LAST_USED_REFRESH_HOURS } from '@/lib/contracts/session-policy';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { deleteSession, findLiveSessionUserId, touchSession } from '@/lib/db/sessions';
import { hashRegisteredSessionToken } from './registered-session-token';

export interface PresentedSession {
  readonly actor: UserActor;
  readonly tokenHash: RegisteredSessionTokenHash;
}

const REFRESH_AFTER_MS = SESSION_LAST_USED_REFRESH_HOURS * 60 * 60 * 1000;

/**
 * Looks a presented token up, WITHOUT refreshing it: the live session it
 * names, or null if it is unknown, expired or idle. Sign-in and registration
 * use this to find the row they must delete before minting a fresh one.
 */
export async function findPresentedSession(token: RegisteredSessionToken): Promise<(PresentedSession & { lastUsedAt: Date }) | null> {
  const tokenHash = hashRegisteredSessionToken(token);
  const live = await findLiveSessionUserId(tokenHash);
  if (!live) return null;
  return { actor: { kind: 'user', userId: live.userId }, tokenHash, lastUsedAt: live.lastUsedAt };
}

export async function resolveRegisteredSession(readCookie: (name: string) => string | undefined): Promise<UserActor | null> {
  const parsed = registeredSessionTokenSchema.safeParse(readCookie(REGISTERED_SESSION_COOKIE_NAME));
  // A missing or malformed cookie never reaches the database.
  if (!parsed.success) return null;

  const presented = await findPresentedSession(parsed.data);
  if (!presented) return null;

  // Refresh `last_used_at` only when it is more than an hour stale — the
  // write is also guarded in SQL. Best effort: a failed refresh must not turn
  // a valid session into an error; the worst case is the idle clock not
  // advancing, and the next request tries again.
  if (Date.now() - presented.lastUsedAt.getTime() > REFRESH_AFTER_MS) {
    try {
      await touchSession(presented.actor, presented.tokenHash);
    } catch {
      console.warn(JSON.stringify({ severity: 'WARNING', event: 'session_touch_failed' }));
    }
  }
  return presented.actor;
}

/**
 * Logout: DELETES the session's row. The adapter then clears the cookie — in
 * that order. Clearing only the cookie would leave a live credential in the
 * database, and hand-rolled database sessions exist precisely so that logout
 * can be real. A token that names no live session (already expired, already
 * logged out) has nothing to delete and is not an error.
 */
export async function endRegisteredSession(token: RegisteredSessionToken): Promise<void> {
  const presented = await findPresentedSession(token);
  if (presented) await deleteSession(presented.actor, presented.tokenHash);
}
