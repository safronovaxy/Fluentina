import 'server-only';

/**
 * KAN-10 session issuance, second half — turns a raw, untrusted cookie
 * value into a trustworthy `GuestActor`, creating the session's row on
 * first use.
 *
 * Framework-free by design (ADR-14): this file has never heard of a cookie
 * header, `next/headers`, or a `Response` — it takes and returns plain
 * values only. `src/app/api/guest-session/route.ts` (the one adapter that
 * calls it) is the only place that reads or writes the actual `Set-Cookie`
 * header; that split is what "the adapter reads the cookie and the
 * session, passes plain values to the domain, gets back an actor and, on a
 * first visit, a new session to set" (the story's own framing) means in
 * code.
 *
 * "Parse, never cast": a raw cookie value only ever becomes a
 * `GuestSessionId` by going through `guestSessionIdSchema.safeParse` below
 * — never a forced `as GuestSessionId`. A forced cast is exactly how the
 * brand's only compile-time guarantee gets erased; `guestSessionIdSchema`'s
 * own comment (lib/contracts/actor.ts) names that as the session-fixation
 * route this closes, and `lib/db/guest-sessions.ts::createGuestSession`
 * re-parses the same value again, independently, as the data layer's own
 * defence against the same route — two checks, not one, because the two
 * layers can't see each other's callers.
 *
 * Deliberately does not live in `src/middleware.ts`: creating a row needs
 * `lib/db`, which needs a real TCP connection to Postgres (`pg`), which the
 * Edge runtime middleware runs on does not provide — see the KAN-10 commit
 * message for the full split this function is one half of.
 */
import { guestSessionIdSchema, type GuestActor } from '@/lib/contracts/actor';
import type { GuestSession } from '@/lib/contracts/guest-session';
import { generateGuestSessionId } from './session-id';
import { createGuestSession, getGuestSessionById } from '@/lib/db/guest-sessions';

export interface ResolvedGuestSession {
  readonly actor: GuestActor;
  readonly session: GuestSession;
  /**
   * True exactly when this call minted a fresh id and/or wrote its row —
   * the only case the calling route handler needs to (re)set the cookie in.
   * False is the "returning guest" path: a valid cookie whose row already
   * existed, resolved with a single read and no write at all.
   */
  readonly isNew: boolean;
}

/**
 * Resolves the guest session for a request, given only the raw string that
 * was in its cookie (`undefined` if there wasn't one).
 *
 * - No cookie, or a value that fails `guestSessionIdSchema` (wrong length,
 *   wrong case, non-hex characters — malformed and forged are
 *   indistinguishable at this layer and handled identically): the value is
 *   never used. A fresh id is generated and its row created; the caller
 *   must overwrite whatever cookie was — or wasn't — there.
 * - A well-formed id with an existing row: returned as-is, no write at all.
 *   This is the returning-guest path the acceptance criteria asks for.
 * - A well-formed id with no row yet: the ordinary first-use path for an id
 *   `src/middleware.ts` minted moments ago, on the same request cycle, and
 *   could not itself persist. Its row is created now, under that exact id.
 */
export async function resolveGuestSession(rawCookieValue: string | undefined): Promise<ResolvedGuestSession> {
  const parsed = guestSessionIdSchema.safeParse(rawCookieValue);

  if (parsed.success) {
    const actor: GuestActor = { kind: 'guest', sessionId: parsed.data };
    const existing = await getGuestSessionById(actor, parsed.data);
    if (existing) {
      return { actor, session: existing, isNew: false };
    }
    return { actor, session: await createSessionTolerably(actor), isNew: true };
  }

  const actor: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
  return { actor, session: await createSessionTolerably(actor), isNew: true };
}

/**
 * `createGuestSession`, tolerant of a concurrent call racing to create the
 * exact same row. Two requests can legitimately resolve the same
 * brand-new, not-yet-persisted id at once — e.g. the guest flow's own
 * session bootstrap firing twice (React Strict Mode's double-invoked
 * effect, or two tabs opened from the same fresh cookie) — and without
 * this, the loser surfaces Postgres's unique-violation to the guest instead
 * of quietly reusing the row the winner just committed.
 */
async function createSessionTolerably(actor: GuestActor): Promise<GuestSession> {
  try {
    return await createGuestSession(actor);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await getGuestSessionById(actor, actor.sessionId);
    // A unique-violation on this exact id can only mean another call's
    // insert already committed it — if a read right after still can't find
    // it, something other than the expected race happened, and swallowing
    // that would hide a real failure.
    if (!existing) throw err;
    return existing;
  }
}

/** Postgres's `unique_violation` SQLSTATE — see the `pg` driver's `DatabaseError`. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
