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
   * True whenever this call wrote a row rather than merely reading one back
   * — ordinary first use (id unchanged) as much as a fresh mint (id
   * changed, e.g. a malformed cookie or one naming an already-converted
   * session). It is NOT, on its own, "the calling route handler needs to
   * (re)set the cookie" — that's `reissued`, below.
   */
  readonly isNew: boolean;
  /**
   * True whenever `actor.sessionId` is NOT the id the caller presented —
   * i.e. whenever the calling adapter must (re)set the cookie, or a later
   * write (an essay insert, say) must use this id rather than whatever the
   * browser's cookie currently says, because the browser doesn't know
   * about the new one yet.
   *
   * False for both "returning guest" (valid id, row already existed) and
   * "ordinary first use" (valid id, row created now, under that exact id):
   * the cookie already in the browser names the right session either way,
   * nothing to reissue. True for every path through `mintFreshGuestSession`
   * — no cookie, a malformed one, or one naming a session that turned out
   * to be unavailable (see `SessionIdUnavailableError`) — since a fresh id
   * was minted and whatever cookie was, or wasn't, there is now stale.
   *
   * Computed here, once, rather than left for each caller to rediscover by
   * string-comparing `actor.sessionId` against the raw value it passed in
   * (`src/app/api/guest-session/route.ts` used to do exactly that — read it
   * from here instead). The same comparison, done wrong or skipped, is how
   * KAN-14's essay submission path would insert an essay under a session id
   * the browser was never told to send back, making the guest unable to
   * ever read their own graded result.
   */
  readonly reissued: boolean;
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
      return { actor, session: existing, isNew: false, reissued: false };
    }
    try {
      const session = await createSessionTolerably(actor);
      return { actor, session, isNew: true, reissued: false };
    } catch (err) {
      if (!(err instanceof SessionIdUnavailableError)) throw err;
      // The cookie named a real id, but one that's no longer available for
      // a guest session — converted, or deleted since, and the recovery is
      // identical either way (see the error's own comment below). That id
      // can never authorise a guest session again. Recover exactly the way
      // a malformed/forged cookie already does: mint a completely different
      // one. This is the fix for the guest who registers, still holds the
      // old cookie, and would otherwise hit a duplicate-key error on every
      // subsequent guest-flow page load.
      return mintFreshGuestSession();
    }
  }

  return mintFreshGuestSession();
}

async function mintFreshGuestSession(): Promise<ResolvedGuestSession> {
  const actor: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
  const session = await createSessionTolerably(actor);
  return { actor, session, isNew: true, reissued: true };
}

/**
 * `createGuestSession`, tolerant of a concurrent call racing to create the
 * exact same row. Two requests can legitimately resolve the same
 * brand-new, not-yet-persisted id at once — e.g. the guest flow's own
 * session bootstrap firing twice (React Strict Mode's double-invoked
 * effect, or two tabs opened from the same fresh cookie) — and without
 * this, the loser surfaces Postgres's unique-violation to the guest instead
 * of quietly reusing the row the winner just committed.
 *
 * Throws `SessionIdUnavailableError` instead of the raw unique-violation
 * when the reread below comes back empty — see that error's own comment for
 * why that specific outcome is never the "something other than the expected
 * race" case the comment used to worry about, and for what it can and can't
 * be taken to mean.
 */
async function createSessionTolerably(actor: GuestActor): Promise<GuestSession> {
  try {
    return await createGuestSession(actor);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await getGuestSessionById(actor, actor.sessionId);
    if (existing) return existing;
    // The ownership-scoped read above applies ownedBy()'s isNull(userId)
    // conjunct (lib/db/ownership.ts), which a guest actor's own,
    // just-inserted-by-someone-else row would always satisfy — its
    // sessionId matches by construction (we tried to insert this exact id)
    // and it cannot have been converted between the insert and this read.
    // A unique-violation whose reread still can't find the row therefore
    // means the row was never ours to begin with: this id belongs to a
    // session that is no longer available as a guest session — most likely
    // converted to a registered account before this call ever ran, but see
    // the error's own comment for the other case this covers.
    throw new SessionIdUnavailableError(actor.sessionId);
  }
}

/**
 * Distinguishes "this id is no longer available for a guest session" from a
 * genuine, unexpected failure during the race-tolerant insert above — see
 * `createSessionTolerably`'s comment for why the reread it follows can only
 * mean this. `resolveGuestSession` catches it, specifically, to recover by
 * minting a different id rather than surfacing the duplicate-key error to
 * the guest as a 500.
 *
 * Named for the recovery, not the cause, on purpose (review, round 2): a
 * 23505 whose ownership-scoped reread comes back empty means either the id
 * converted (the case this was written for) or the row was deleted since —
 * a 30-day retention sweep, or a right-to-erasure cascade, landing between
 * the failed insert and the reread. `resolveGuestSession` recovers
 * identically either way, mint a fresh id, so the two are indistinguishable
 * here and this error must not be read as "converted" by anything that
 * counts occurrences of it for a conversion metric — it would silently
 * mislabel retention deletions as conversions.
 *
 * The guarantee this rests on is actually stronger than "probably
 * converted": Postgres blocks the second inserter on a conflicting key
 * until the first transaction ends, and if the first one rolls back, the
 * second insert simply succeeds instead of conflicting — so seeing a 23505
 * at all implies a row under this id was, at that instant, COMMITTED. That
 * is what makes the reread above a meaningful check rather than a race with
 * an uncommitted insert: whatever the reread's answer, something real was
 * there a moment ago.
 */
class SessionIdUnavailableError extends Error {
  constructor(sessionId: string) {
    super(`guest session id "${sessionId}" is no longer available for a guest session`);
    this.name = 'SessionIdUnavailableError';
  }
}

/**
 * Postgres's `unique_violation` SQLSTATE — see the `pg` driver's
 * `DatabaseError`. Checked at two levels because Drizzle never lets that
 * `DatabaseError` reach a caller directly: every query it runs is wrapped in
 * its own `DrizzleQueryError`, whose `code` is undefined — the SQLSTATE only
 * ever shows up one level down, on `.cause`, which is the original driver
 * error. Probed against a real conflict: `err.code` is `undefined` and
 * `err.cause.code` is `'23505'`. Checking only the top level (the original,
 * broken implementation) never matches a real conflict at all — it always
 * rethrows, which is the duplicate-key 500 this function exists to prevent.
 */
function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, '23505') || hasSqlState(getCause(err), '23505');
}

function hasSqlState(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

function getCause(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'cause' in err ? err.cause : undefined;
}
