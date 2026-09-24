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
 * Round-2 review (Architect, Test Lead, independently): this headline used
 * to still say "30 essay submissions per IP per hour — 6x the per-session
 * cap" — the number round-1 review replaced, thirteen lines below, with 120.
 * One comment block stated two different caps for the same security-relevant
 * number, and this line is the one a reviewer reads first. Corrected to
 * match the constant and the paragraph explaining it:
 *
 * 120 essay submissions per IP per hour — 24x the per-session cap. Justified
 * against two things this deployment already has, not picked in a vacuum:
 *
 * 1. The "shared network" acceptance criterion. Round-1 review (Architect,
 *    blocking): this used to be 30 (6x the session cap), reasoned against "a
 *    small classroom, a household". Measured against the product this
 *    actually is — a Goethe-exam practice tool sold into language schools —
 *    a single lesson is the realistic first traffic shape, not the edge
 *    case: twelve students behind one shared school egress IP, three essays
 *    each, is 36 submissions inside an hour, comfortably over the old cap.
 *    Worse, a rejected request still increments the IP counter (see
 *    `underIpLimit`'s own comment on why both counters always increment,
 *    win or lose), so the back half of a blocked class retrying makes the
 *    block worse for everyone left on that network, not better. 120 is 4x
 *    the old number and 24x the session cap — comfortably above a full
 *    classroom's worth of legitimate concurrent use (twelve students at
 *    five essays each, the session cap's own ceiling, is 60), while still
 *    bounding a single real abuser to 120 gradings/hour from one address.
 * 2. The existing Cloud Armor rate-based ban: 100 requests/minute from one
 *    source (6,000/hour) triggers a 10-minute ban today, regardless of which
 *    endpoint those requests hit or what any of them cost. That backstop is
 *    blunt on purpose — it knows nothing about this endpoint's actual cost
 *    (a future grading call, KAN-16, not yet built) — and 120/hour still
 *    sits fifty times below it, so THIS cap is the one that actually
 *    protects grading cost from a single-IP abuser; Cloud Armor is the
 *    fallback for raw request-flood abuse this cap was never meant to catch
 *    (a burst far faster than even an abusive human clicking submit).
 *
 * No traffic baseline exists yet to tune either number against — see this
 * story's own PR description for what should be measured (submissions per
 * session, per IP, and the shape of legitimate shared-network traffic)
 * before either constant is revisited. Both per-address limits below
 * (`ESSAY_SUBMISSION_IP_LIMIT`, `GUEST_SESSION_RESOLVE_IP_LIMIT`) — the
 * numbers this story delegates to engineering judgement rather than the
 * ticket fixing them outright — read from the environment, with the values
 * above as their defaults, specifically so the classroom-size question
 * above can be retuned once real traffic exists, as a configuration change
 * rather than a rebuild.
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
 * remint loop into a bounded one; 240/hour per IP is double the essay
 * endpoint's own backstop (see above) for the same cheaper-cost reason —
 * raised from 60 in step with the essay endpoint's own IP limit above, to
 * keep that 2x relationship true rather than leaving a stale number that
 * happened to still be "looser" by less than the stated reason.
 */
import { createHash } from 'node:crypto';
import { incrementRateLimitCounter } from '@/lib/db/rate-limit';
import type { GuestSessionId } from '@/lib/contracts/actor';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Reads a positive integer override from `process.env[name]`, falling back
 * to `fallback` when the variable is unset, blank, non-numeric, zero,
 * negative, or too large to represent exactly — never a value that would
 * silently disable or zero out a cap. Server-only (this whole module is):
 * nothing here is a `NEXT_PUBLIC_*` var, so these are never baked into the
 * client bundle, unlike everything in `.env.example`'s existing entries.
 *
 * Round-2 review (Test Lead): every branch above was already correct but
 * untested — nothing exercised this function directly, only the module-load
 * constants that call it once, which a table-driven test can't cheaply
 * re-trigger per case. Exported so `rate-limit.test.ts` can call it directly
 * with every input in the table, not a public helper meant for reuse
 * elsewhere.
 *
 * Also round-2 (Test Lead, the two questions this comment used to leave
 * open): `Number.parseInt` stops at the first character it can't parse
 * rather than rejecting the rest of the string — "1e4" (scientific notation
 * for 10000) parsed as `1`, and "5.5" parsed as `5`, both silently, with no
 * error. Neither would ever zero out or unbound a cap (the `> 0` check below
 * still catches that), but both would silently configure a completely
 * different number than the one an operator typed — a worse failure mode
 * than falling back to the documented default, which is at least the
 * behaviour `.env.example` describes. Decided: reject both rather than
 * round or truncate — a value must be a plain non-negative integer literal
 * (digits only; no sign, decimal point, or exponent) or it falls back, the
 * same as a non-numeric string always has.
 *
 * Final review round (Architect, consider): the stricter parse above closed
 * the too-LENIENT cases but left the unsafe direction open — the digits-only
 * regex has no length bound, so a 23-digit typo still passes it and the `> 0`
 * check below, and `Number.parseInt` happily returns a number far past
 * `Number.MAX_SAFE_INTEGER`, which is large enough to effectively disable
 * whichever cap it configures. Not a regression (the previous, more lenient
 * check let the same string through too), and an operator fat-fingering 23
 * digits is unlikely, but the failure mode is exactly the one this whole
 * function exists to prevent — a cap silently unbounded rather than falling
 * back to the documented default. `Number.isSafeInteger` closes it: every
 * value this function returns is now guaranteed representable exactly.
 * Trimming: leading/trailing whitespace (a value pasted into a shell or a
 * platform's env-var console, a realistic source of stray whitespace this
 * function used to reject silently, indistinguishable from a typo) is
 * stripped before the shape check, so " 17 " configures 17 rather than
 * falling back to the default the same way "not-a-number" does.
 *
 * Final review round (Test Lead, consider): nothing told an operator their
 * override was ignored — a rejected value (any branch below that falls back
 * to `fallback` because something WAS actually typed, as opposed to the
 * variable being absent or blank) now logs one warning via
 * `warnRejectedEnvOverride`. Fires at most once per constant per process:
 * every call site below is a module-level constant evaluated exactly once
 * on import, never per request, so "once per process" needs no explicit
 * de-duplication here — it falls out of that call shape for free.
 */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (!/^\d+$/.test(trimmed)) {
    warnRejectedEnvOverride(name, raw, fallback);
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!(parsed > 0 && Number.isSafeInteger(parsed))) {
    warnRejectedEnvOverride(name, raw, fallback);
    return fallback;
  }
  return parsed;
}

/**
 * The one warning this module emits for a rejected environment override —
 * see `positiveIntEnv`'s own comment for when this fires (present but
 * rejected, never for an absent or blank variable) and why once per process
 * is enough. `console.warn`, not `console.log` at `logRefusal`'s WARNING
 * severity: this is a configuration problem for an operator to notice at
 * startup, not a per-request signal — `logRefusal`'s own comment is explicit
 * that a per-request log line here would be alert-fatigue noise, and that
 * reasoning doesn't apply to something that fires at most once per constant.
 * The rejected raw value is safe to log, unlike a session id or an address
 * elsewhere in this file: it is operator-typed deployment configuration, not
 * personal data about an essay-grading visitor.
 */
function warnRejectedEnvOverride(name: string, raw: string, fallback: number): void {
  console.warn(
    JSON.stringify({
      severity: 'WARNING',
      event: 'rate_limit_env_override_rejected',
      name,
      value: raw,
      fallback,
    }),
  );
}

/** Fixed by the ticket — not an engineering call. See this module's own comment. */
export const ESSAY_SUBMISSION_SESSION_LIMIT = 5;
export const ESSAY_SUBMISSION_SESSION_WINDOW_MS = ONE_HOUR_MS;

/**
 * The per-IP backstop, and its window — see this module's own comment for
 * the justification behind 120, and for why this reads from the
 * environment rather than being a bare literal.
 *
 * Round-2 review (Test Lead): tuned as a PAIR with
 * `GUEST_SESSION_RESOLVE_IP_LIMIT` below, which is documented (that
 * constant's own comment) as deliberately double this one. Both are
 * independently overridable via the environment, so setting only this one
 * without also raising the other breaks that documented 2x relationship
 * silently — nothing enforces it at runtime. Retuning either one against
 * real traffic should retune both together.
 */
export const ESSAY_SUBMISSION_IP_LIMIT = positiveIntEnv('RATE_LIMIT_ESSAY_SUBMISSION_IP_LIMIT', 120);
export const ESSAY_SUBMISSION_IP_WINDOW_MS = ONE_HOUR_MS;

export const GUEST_SESSION_RESOLVE_SESSION_LIMIT = 20;
export const GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS = ONE_HOUR_MS;

/**
 * See this module's own comment for why 240 (double the essay endpoint's
 * own backstop). Round-2 review (Test Lead): tuned as a PAIR with
 * `ESSAY_SUBMISSION_IP_LIMIT` above — same caveat, same direction: an
 * override to one without the other silently breaks the documented 2x
 * relationship between them.
 */
export const GUEST_SESSION_RESOLVE_IP_LIMIT = positiveIntEnv('RATE_LIMIT_GUEST_SESSION_RESOLVE_IP_LIMIT', 240);
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

/**
 * KAN-25 item 5 (round-1 review, blocking — this module's own top comment
 * admits no traffic baseline exists to validate either cap against, so
 * without this, there is no way to tell a working limiter from a broken
 * one in production, and that admission is unfalsifiable): the one
 * structured line this story emits, on REFUSAL only — which cap fired
 * (`action`+`scope`), the count that tripped it, and a correlation key for
 * WHO tripped it (see `hashAndTruncate` below for exactly what that key is
 * and is not). Deliberately minimal; the fuller picture (latency, volume
 * trends, alerting) belongs to KAN-24, not this story — this is only what
 * makes the threshold this module cannot validate at least observable.
 *
 * `severity` (round-2 review, Architect: not present before) is what lets
 * this line sort above routine request logs and be driven off in an alert —
 * the whole reason this line exists is that nothing else tells an on-call
 * engineer a cap is firing.
 *
 * Round-2 review (Architect, Test Lead, independently, both measured this):
 * a session-scoped refusal used to log NO identity at all — "the session id
 * is a bearer credential, and a log line is not the place for one, hashed
 * or not". That rule was too broad, and backwards for what this logging
 * exists to answer: `hashAndTruncate` below is genuinely one-way for a
 * HIGH-entropy secret like a guest session id (recovering the original
 * value from 48 bits of truncated hash by brute force is not the same
 * search problem as enumerating a small space) but was NOT one-way for the
 * LOW-entropy address it was actually protecting — see that function's own
 * comment. This module had the two backwards: the address that COULD be
 * brute-forced got hashed, and the session id that genuinely couldn't be
 * got nothing. The consequence: five hundred session-scoped refusal lines
 * were indistinguishable between one repeat abuser and five hundred
 * different learners tripping a cap set too tight — exactly the question
 * this logging exists to answer given no traffic baseline exists to tune
 * against. Every refusal now carries an `identityHash`, computed the same
 * way regardless of scope; the raw value never appears in THIS refusal log,
 * in either scope.
 *
 * Final review round (Architect, blocking — narrowed rather than widened by
 * that finding): the line above used to claim the raw value "never appears
 * in either case", full stop. True of this refusal log; false of a
 * different path this function has no control over — a FAILED counter
 * increment used to put the raw bucket key (hence the raw session id or
 * address embedded in it) into the underlying query error's own message,
 * unguarded, with nothing anywhere in this call chain to catch it. That is
 * `lib/db/rate-limit.ts`'s concern, not this one's — see
 * `incrementRateLimitCounter`'s own comment for the fix — but this comment
 * had no business making a claim broader than the one thing `logRefusal`
 * and `hashAndTruncate` actually control.
 */
function logRefusal(action: string, scope: 'session' | 'ip', limit: number, count: number, identity: string): void {
  console.log(
    JSON.stringify({
      severity: 'WARNING',
      event: 'rate_limit_refused',
      action,
      scope,
      limit,
      count,
      identityHash: hashAndTruncate(identity),
    }),
  );
}

/**
 * A stable correlation key for `value` across log lines — NOT
 * pseudonymisation. Round-2 review (Architect, Test Lead, independently
 * measured): the comment that used to sit here called this "a short,
 * non-reversible-in-practice fingerprint". False for a LOW-entropy input:
 * an IPv4 address is one of roughly four billion values, this is an
 * unsalted hash of it truncated to 48 bits, and the entire space is
 * brute-forceable — the Architect recovered a specific address from its
 * hash in 35ms, and both reviewers independently put the full address space
 * at roughly half an hour on one core. Anyone with read access to these
 * logs recovers every refused address exactly; this value IS personal data,
 * recoverable, and inherits whatever retention policy the log store has —
 * a privacy or retention answer built on "pseudonymised" would be wrong.
 *
 * For a HIGH-entropy input — a guest session id (see session-id.ts) — the
 * same construction genuinely is a one-way correlation key: there is no
 * space small enough to brute-force from 48 bits of truncated hash output
 * back to the original value. That asymmetry is a property of the INPUT's
 * entropy, not of this function, which does not know or care which kind of
 * value it's given — see `logRefusal`'s own comment for why both scopes now
 * log one.
 *
 * The real fix for the address side is salting with a per-deployment
 * secret, closing the brute-force gap outright. Not done here: it needs
 * secret management this app's own runtime doesn't have wired (see
 * CLAUDE.md's Secrets list — every entry there backs the CMS, none of it
 * this app). Flagged for whichever story wires that, not a decision to make
 * unilaterally in this one.
 */
function hashAndTruncate(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * True while `bucketKey`'s count for the window containing `now` is still
 * at or under `limit`, having just incremented it. `log` identifies which
 * cap this call is checking, purely for `logRefusal` above — never
 * consulted for the pass/fail decision itself. `log.identity` is required
 * (round-2 review — see `logRefusal`'s own comment for why a session-scoped
 * refusal now logs a correlation key the same as an IP-scoped one does,
 * rather than the identity being optional and omitted for one of the two).
 */
async function underLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: Date,
  log: { action: string; scope: 'session' | 'ip'; identity: string },
): Promise<boolean> {
  const windowStart = windowStartFor(now, windowMs);
  const count = await incrementRateLimitCounter(bucketKey, windowStart);
  const ok = count <= limit;
  if (!ok) logRefusal(log.action, log.scope, limit, count, log.identity);
  return ok;
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
  return underLimit(`${action}:ip:${ip}`, limit, windowMs, now, { action, scope: 'ip', identity: ip });
}

/**
 * `POST /api/essays`'s rate limit — both caps, always both checked (never
 * short-circuited): a request that fails the session cap still increments
 * the IP counter, and vice versa, so a caller cannot dodge one counter by
 * arranging to fail the other first. `sessionId` is the RAW, schema-
 * validated cookie value the caller presented (route.ts calls this BEFORE
 * `resolveGuestSession` ever runs — see that route's own comment on why),
 * not a resolved actor — see this module's own top comment for why that
 * specific choice is what the design rests on. Round-1 review (Architect):
 * this doc comment used to say "the actor's resolved session id", disagreeing
 * with both the top-of-module comment and route.ts's own comment, neither
 * of which this ever was true of — corrected to match the code and the
 * other two. `ip` is `clientIp(request)` (`lib/client-ip.ts`).
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
    { action: 'essaySubmission', scope: 'session', identity: sessionId },
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
    { action: 'guestSessionResolve', scope: 'session', identity: sessionId },
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
