import 'server-only';

/**
 * KAN-25 — the rate-limit policy: what the two caps actually are, and the
 * fixed-window bucketing that turns "N per identity per hour" into the one
 * atomic Postgres statement `lib/db/rate-limit.ts` exposes. See that file's
 * own comment, and `rateLimitCounters`' (schema.ts), for where the counter
 * lives and why that answer is "the existing shared Postgres instance", not
 * in-memory or a new piece of infrastructure.
 *
 * Two guards, one shape, applied at two call sites:
 *
 * - `checkEssaySubmissionRateLimit` — `POST /api/essays` (route.ts). The
 *   session cap (5/hour) is the acceptance criterion verbatim, not an
 *   engineering call; the IP cap is.
 * - `checkGuestSessionResolveRateLimit` — `POST /api/guest-session`
 *   (route.ts). Added for the same reason the essay endpoint needs one, not
 *   a lighter version of it: the accumulated finding on this ticket is that
 *   the converted-session recovery path (`resolveGuestSession`'s
 *   `SessionIdUnavailableError` branch) mints a fresh row on every call from
 *   a client that keeps presenting an unavailable id, and today nothing
 *   bounds how many times that happens. Both limits below key on the RAW,
 *   schema-validated cookie value the caller presented — not the actor
 *   `resolveGuestSession` eventually resolves to — specifically so that
 *   abuse pattern is bounded even though the resolved session id changes on
 *   every call: the raw presented value stays the one constant a repeatedly-
 *   failing client keeps sending.
 *
 * Both caps for both actions must be exceeded independently for a request to
 * be rejected as `false` here — the caller decides everything else (which
 * `RejectionReason` to return, at which point in the route the check runs).
 * This module never touches `NextResponse`, a cookie, or a header; it takes
 * plain identity strings and returns a plain boolean, the same ADR-14 split
 * `lib/domain/guest-session.ts` already follows.
 *
 * --- Per-session cap: fixed by the ticket ---
 *
 * Five per guest session per hour. Not an engineering call — the ticket says
 * so explicitly, and this module treats it as a named constant rather than a
 * literal for the same reason every other cross-referenced number in this
 * codebase is (see e.g. `MIN_ESSAY_WORDS`/`MAX_ESSAY_WORDS` in
 * `lib/contracts/word-count.ts`): one place to point at, not a number a test
 * or a route re-derives.
 *
 * This cap alone is trivially bypassable: a caller that clears its session
 * cookie and reloads any guest-flow page gets a brand-new id from
 * `src/middleware.ts` (Edge, no DB write, no rate limit of its own — it
 * cannot call this module at all, being Edge) and a fresh budget of five.
 * Repeat forever, from the same machine, and the session cap alone never
 * fires twice. The IP cap below is what actually bounds that — the ticket's
 * own framing for why it exists ("must not be trivially bypassable by
 * clearing the session cookie. That is what the per-IP backstop is for").
 *
 * --- Per-IP cap: an engineering call, made here ---
 *
 * 30 essay submissions per IP per hour — 6x the per-session cap. Justified
 * against two things this deployment already has, not picked in a vacuum:
 *
 * 1. The "shared network" acceptance criterion. 6x comfortably covers a
 *    handful of guests writing concurrently behind one shared egress IP (a
 *    small classroom, a household) each independently exhausting their own
 *    5/hour budget, without the IP cap being the thing that stops them —
 *    it bites only once traffic from one address looks like six or more
 *    independent guests' worth of submissions within the same hour, which
 *    ordinary shared-network usage does not produce.
 * 2. The existing Cloud Armor rate-based ban: 100 requests/minute from one
 *    source (6,000/hour) triggers a 10-minute ban today, regardless of which
 *    endpoint those requests hit or what any of them cost. That backstop is
 *    blunt on purpose — it knows nothing about this endpoint's actual cost
 *    (a future grading call, KAN-16, not yet built) — and 30/hour sits two
 *    orders of magnitude below it, so THIS cap is the one that actually
 *    protects grading cost from a single-IP abuser; Cloud Armor is the
 *    fallback for raw request-flood abuse this cap was never meant to catch
 *    (a burst far faster than even an abusive human clicking submit).
 *
 * No traffic baseline exists yet to tune either number against — see this
 * story's own PR description for what should be measured (submissions per
 * session, per IP, and the shape of legitimate shared-network traffic)
 * before either constant is revisited.
 *
 * --- Guest-session-resolve caps ---
 *
 * Looser than the essay caps on both axes: this endpoint's cost is a cheap,
 * indexed row read (and, on first use or reissue, one row insert) — no
 * content, no future grading call — so the numbers below exist to bound the
 * "repeated remint" pattern the accumulated finding names, not to protect an
 * expensive downstream call the way the essay caps do. 20/hour per presented
 * session id is generous for the real call pattern (`GuestSessionBootstrap`
 * calls this once per guest, per KAN-10) while still turning an unbounded
 * remint loop into a bounded one; 60/hour per IP is double the essay
 * endpoint's backstop for the same cheaper-cost reason.
 */
import { incrementRateLimitCounter } from '@/lib/db/rate-limit';
import type { GuestSessionId } from '@/lib/contracts/actor';

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Fixed by the ticket — not an engineering call. See this module's own comment. */
export const ESSAY_SUBMISSION_SESSION_LIMIT = 5;
export const ESSAY_SUBMISSION_SESSION_WINDOW_MS = ONE_HOUR_MS;

/** The per-IP backstop, and its window — see this module's own comment for the justification. */
export const ESSAY_SUBMISSION_IP_LIMIT = 30;
export const ESSAY_SUBMISSION_IP_WINDOW_MS = ONE_HOUR_MS;

export const GUEST_SESSION_RESOLVE_SESSION_LIMIT = 20;
export const GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS = ONE_HOUR_MS;

export const GUEST_SESSION_RESOLVE_IP_LIMIT = 60;
export const GUEST_SESSION_RESOLVE_IP_WINDOW_MS = ONE_HOUR_MS;

/**
 * The window a moment in time falls into, for a fixed-window counter of
 * length `windowMs` — every instant between two multiples of `windowMs`
 * (measured from the Unix epoch) shares one `windowStart`, hence one row in
 * `rate_limit_counters`, hence one shared count. See `rateLimitCounters`'
 * own comment (schema.ts) for the boundary-burst trade-off this implies.
 */
function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** True while `bucketKey`'s count for the window containing `now` is still at or under `limit`, having just incremented it. */
async function underLimit(bucketKey: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
  const windowStart = windowStartFor(now, windowMs);
  const count = await incrementRateLimitCounter(bucketKey, windowStart);
  return count <= limit;
}

/**
 * True while the IP-scoped cap for `action` is still under `limit` — or
 * trivially true when `ip` is `null`, i.e. the IP-scoped check is skipped
 * entirely rather than applied against some shared placeholder identity.
 * `null` is `clientIp`'s answer (`lib/client-ip.ts`, see that module's own
 * comment for the full, twice-revised reasoning) whenever a request cannot
 * be shown to have actually passed through this deployment's one trusted
 * proxy hop — never expected for real production traffic, routinely true
 * for a direct, no-load-balancer test run. Such a caller gets no IP-scoped
 * backstop for that one request, not a shared bucket that lets it exhaust
 * the budget for every other caller sharing it (measured directly: that was
 * the actual, verified cause of two different failed attempts at this exact
 * fallback — see `clientIp`'s own comment). The session-scoped cap (always
 * checked, never skipped) still applies regardless — this only ever widens
 * what the IP backstop alone would have blocked, never what the session cap
 * blocks on its own.
 */
async function underIpLimit(action: string, ip: string | null, limit: number, windowMs: number, now: Date): Promise<boolean> {
  if (ip === null) return true;
  return underLimit(`${action}:ip:${ip}`, limit, windowMs, now);
}

/**
 * `POST /api/essays`'s rate limit — both caps, always both checked (never
 * short-circuited): a request that fails the session cap still increments
 * the IP counter, and vice versa, so a caller cannot dodge one counter by
 * arranging to fail the other first. `sessionId` is the actor's resolved
 * session id (see route.ts's own comment on why the route already holds
 * one before this runs); `ip` is `clientIp(request)` (`lib/client-ip.ts`).
 */
export async function checkEssaySubmissionRateLimit(
  sessionId: GuestSessionId,
  ip: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const sessionOk = await underLimit(
    `essaySubmission:session:${sessionId}`,
    ESSAY_SUBMISSION_SESSION_LIMIT,
    ESSAY_SUBMISSION_SESSION_WINDOW_MS,
    now,
  );
  const ipOk = await underIpLimit('essaySubmission', ip, ESSAY_SUBMISSION_IP_LIMIT, ESSAY_SUBMISSION_IP_WINDOW_MS, now);
  return sessionOk && ipOk;
}

/**
 * `POST /api/guest-session`'s rate limit. `sessionId` here is the RAW,
 * schema-validated cookie value the caller presented, not a resolved actor —
 * see this module's own top comment for why that specific choice is what
 * bounds the converted-session remint loop the accumulated finding names.
 */
export async function checkGuestSessionResolveRateLimit(
  sessionId: GuestSessionId,
  ip: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const sessionOk = await underLimit(
    `guestSessionResolve:session:${sessionId}`,
    GUEST_SESSION_RESOLVE_SESSION_LIMIT,
    GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS,
    now,
  );
  const ipOk = await underIpLimit(
    'guestSessionResolve',
    ip,
    GUEST_SESSION_RESOLVE_IP_LIMIT,
    GUEST_SESSION_RESOLVE_IP_WINDOW_MS,
    now,
  );
  return sessionOk && ipOk;
}
