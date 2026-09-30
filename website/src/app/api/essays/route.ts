import { NextRequest, NextResponse } from 'next/server';
import { submitEssay } from '@/lib/domain/essay-submission';
import { resolveGuestSession } from '@/lib/domain/guest-session';
import { resolveOwnerActor } from '@/lib/domain/owner-actor';
import { checkEssaySubmissionRateLimit } from '@/lib/domain/rate-limit';
import { startGrading } from '@/lib/domain/grading/start-grading';
import { logEssaySubmission } from '@/lib/domain/essay-submission-telemetry';
import { essaySubmissionRequestSchema, isEssayLengthRejectionReason } from '@/lib/contracts/essay-submission';
import type { OwnerActor } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';
import { clientIp } from '@/lib/client-ip';
import { rejectionResponse } from '@/lib/rejection-response';
import { readBoundedJsonBody } from '@/lib/request-body';

/**
 * POST /api/essays — KAN-14, essay submission; word-count enforcement added by
 * KAN-15. Storage only: this route persists the essay and reports its id back,
 * nothing more. Grading (KAN-16) is a separate story that builds on this
 * endpoint rather than being part of it. The word-count bounds themselves
 * (50-300 words, BR-1.4 through BR-1.7) live entirely in
 * `essaySubmissionRequestSchema` (see that schema's own comment for the seam
 * this filled) — this route's only KAN-15-specific job is turning a
 * length-based rejection into its own distinguishable message, below.
 *
 * --- WHO MAY SUBMIT (KAN-52) — read this before touching the guards below ---
 *
 * This is NOT a guest-only endpoint any more. It used to be, and this comment
 * used to say so at length; the defect that comment protected was the opposite
 * one. Ownership was decided by a guest SESSION rather than by an `OwnerActor`:
 * a registered user submitting an essay created a guest-owned one (`user_id
 * IS NULL`) their own account could not read, and a registered user with no
 * guest cookie could not submit at all. The submitter is now an `OwnerActor`,
 * from `resolveOwnerActor` — the same resolution the read routes use:
 *
 *   1. a live REGISTERED session wins: the essay is inserted owned by that
 *      account (`session_id` NULL, `user_id` set), no guest session is read,
 *      resolved, created or locked, and no cookie is set;
 *   2. otherwise a well-formed GUEST cookie: the guest path, as it always was;
 *   3. otherwise neither: rejected (400 `invalidSessionCookie`), nothing
 *      resolved, nothing minted.
 *
 * The order is not a preference. A converted user's stale guest cookie still
 * names a real (converted) session row. `createEssay`'s post-conversion branch
 * means a `GuestActor` built from it would still INSERT a correctly-owned essay
 * (that is no longer the hazard), but everything downstream of the insert would
 * treat the submitter as the guest they no longer are:
 *
 *   - `startGrading(guestActor, …)` applies `ownedBy(guestActor)` to a row whose
 *     `session_id` is NULL: zero rows, so it logs and returns WITHOUT enqueuing.
 *     The submitter gets a 201 for an essay that is never graded;
 *   - `reportAccessFor(guestActor)` is `'locked'`, so a registered owner sees
 *     only the teaser of their own grade;
 *   - the BR-1.8 bucket would key on `essaySubmission:session:<id>`, so keeping
 *     a stale guest cookie would dodge the per-user cap.
 *
 * A test pins "the registered session wins even when the request also carries a
 * valid guest cookie" — do not resolve a guest session ahead of, or as well as,
 * the account.
 *
 * KAN-31: every rejection below carries a `reason` code alongside its status and
 * message — drawn from the single union in `lib/contracts/rejection-reason.ts`,
 * which also carries the full case for why this exists: a status-only test
 * cannot tell one guard's rejection apart from another's, and KAN-15's own
 * 50-word floor already proved that silently, firing ahead of this route's
 * cookie guard for two tests that happened to use short fixtures. See
 * route.test.ts for the tests asserting `reason` on every branch.
 *
 * Round-1 review: every rejection below is built by `rejectionResponse`
 * (`lib/rejection-response.ts`) rather than each branch spelling out its own
 * `NextResponse.json({ error, reason: '...' satisfies RejectionReason },
 * { status })`. That shape let a reason be OMITTED entirely and still
 * compile; `reason` is `rejectionResponse`'s first, required, positional
 * parameter, so a call that forgets it fails to compile instead of shipping
 * to be caught by a reviewer or a test that happened to assert one. A branch
 * that instead called `NextResponse.json` directly for a rejection would still
 * compile, which is what the `no-restricted-syntax` rule in `eslint.config.js`
 * (scoped to this file, `lib/request-body.ts` and the other adopting routes)
 * exists to rule out, by blocking a literal `status >= 400` inside a direct
 * `NextResponse.json(...)` call. See `lib/rejection-response.ts`'s own comment
 * for the rest of this reasoning and the pinned compile-time proof
 * (`rejection-response.typecheck.ts`).
 *
 * Never logs the request body — see the `never log essay text` rule this
 * route is built against; nothing in this file (or anything it calls)
 * writes `content` anywhere but the one `createEssay` insert.
 *
 * --- The guest path: never mint from an unauthenticated call ---
 *
 * Round-1 review (blocking): this route used to pass whatever raw cookie
 * value it read — `undefined` included — straight into `resolveGuestSession`
 * (via `submitEssay`), whose contract for a missing or malformed value is to
 * MINT a fresh session and create its row. That is the exact property
 * `/api/guest-session` (KAN-10) spent three review rounds removing — see
 * that route's own "review" comment for the full case for why minting on an
 * unauthenticated call is a real hole (a second, unauthenticated cookie
 * issuer; a forged call silently replacing a real guest's in-progress
 * session). That property still holds, and the KAN-52 change must not weaken
 * it: a caller with neither a live registered session nor a well-formed guest
 * cookie is rejected outright (400, nothing resolved, no row created), never
 * minted. `resolveOwnerActor` returns `null` for exactly that caller and never
 * calls `resolveGuestSession`.
 *
 * By the time a real guest's browser reaches here, `src/middleware.ts` has
 * already minted and set a valid cookie on this exact navigation — see
 * `GuestSessionBootstrap`'s own comment for why this route still resolves
 * (rather than trusting a row already exists): an ad blocker, disabled
 * JavaScript, or a request that simply beat the bootstrap call would
 * otherwise leave a cookie with no `guest_sessions` row behind it, and the
 * essay insert would fail on the foreign key after a guest has already
 * written up to 300 words. That is a well-formed cookie naming no row YET —
 * resolution creates it. It is not the same case as no cookie at all. The
 * only real case a missing/malformed cookie covers is a browser refusing to
 * store it outright (e.g. WebKit refusing a `__Host-`-prefixed cookie over
 * plain HTTP), and minting does not help that guest either: the reissued
 * cookie in the response is refused the same way, and their essay becomes an
 * unreadable orphan until retention deletes it. Rejecting is the more honest
 * outcome, and the same one `/api/guest-session` already reached.
 *
 * For a GUEST, this route resolves the session itself (`resolveGuestSession`,
 * imported directly — not through `submitEssay`, which only persists under an
 * already-resolved actor; see that function's own comment) rather than trusting
 * that `GuestSessionBootstrap` already ran, for the "no row yet" reason above.
 * A registered submitter never reaches that call.
 *
 * Trap the guest path exists to close (the Architect's own framing): if this
 * inserted the essay under whatever session id the browser's cookie
 * presented, rather than under the id `resolveGuestSession` actually
 * resolved to, a guest whose presented id named an unavailable session
 * (most often, one that already converted to a registered account) would
 * have their essay stored under an id their own browser is never told
 * about — unreadable by them, forever, until retention deletes it. Setting
 * the cookie below whenever `reissued` is true, to the exact id the essay
 * was actually stored under, is what avoids that; see `resolveGuestSession`'s
 * own `reissued` doc comment (lib/domain/guest-session.ts) for the rest of
 * this reasoning. `reissued` is a guest-only notion: a registered submitter's
 * response never sets the guest cookie, and never reads `essay.sessionId`
 * (which is NULL for an account-owned essay — the reissue below is guarded on
 * the actor's kind, not on the field merely being present).
 *
 * The actor comes from the cookies, and only the cookies — never from the
 * request body. `essaySubmissionRequestSchema` has no `sessionId`/`userId`
 * field and never will (see that schema's own comment); this route does not
 * read one off `parsed.data` for exactly that reason; a body field naming a
 * different, existing session or user is how any caller could attribute an
 * essay to a victim merely by naming them, with nothing reissued and nothing
 * for the real owner to notice (see route.test.ts's own tests for this).
 *
 * Same cross-origin guard as `src/app/api/guest-session/route.ts` — see that
 * route's own comment for the full reasoning this shares (extracted into
 * `lib/same-origin.ts` once this became the second route that needed it, as
 * that module's own KAN-10 review note said would happen). In short: the
 * guard is defence in depth against a forged `Origin`/forwarded-host pair,
 * not this route's actual authorisation — the mandatory, `SameSite=Lax`
 * session cookie (either one; a caller presenting neither is rejected, above)
 * is what a cross-site browser request cannot attach at all. Pinning the
 * comparison to a genuinely proxy-set value is KAN-28.
 *
 * Round-2 review: the actor check below runs immediately after the
 * cross-origin guard, ahead of every body-reading step — it used to run
 * last, after the raw body was already buffered and parsed. An anonymous
 * caller presenting no cookie at all costs this route nothing beyond the two
 * cheap header checks: no bytes read off the wire, no JSON parse. A caller
 * presenting a well-formed 64-hex cookie costs one indexed `sessions` read
 * (and, for a live session past its refresh window, one `touchSession` write)
 * before any cap applies (KAN-52) — a malformed or absent one never reaches the
 * database. That cost is unavoidable (a per-owner bucket cannot be keyed before
 * the owner is known) and is bounded by Cloud Armor's per-IP ban. This also matters for KAN-25, which wants the actor in
 * hand before the route does any work on an anonymous caller's behalf.
 *
 * KAN-25: the rate-limit check runs immediately after that actor guard, ahead
 * of the Content-Length pre-check and everything below it — the same "before
 * the body is read" placement, extended one guard further. A caller that has
 * already exhausted either cap (five submissions/hour for their owner —
 * `lib/domain/rate-limit.ts` carries the numbers and the justification for
 * each — or the looser per-IP backstop) never costs this route the up-to-128KB
 * buffer `readBoundedJsonBody` would otherwise allocate.
 *
 * KAN-52 (BR-1.8): the per-owner bucket is keyed on whichever identity the
 * actor carries — the guest session id, or the registered user's id. A
 * registered user MUST be counted per user: with no guest cookie there is no
 * session id to key on, and falling through to the per-IP backstop alone would
 * be 24x the mandated cap and up to 120 paid grading calls per address per
 * hour. For a guest, the actor's `sessionId` is the RAW, schema-validated cookie
 * value — `resolveGuestSession` itself still runs only where it always has,
 * after the essay content is validated (see that call's own comment, below), so
 * a body-content rejection still creates no `guest_sessions` row (see
 * route.test.ts's own "creates no guest session row" tests). For the one case
 * the raw and resolved ids could ever differ (the presented id names an
 * already-converted session — see `resolveGuestSession`'s own
 * `SessionIdUnavailableError` handling) that request was always going to insert
 * under a freshly minted id anyway, so counting the stale one costs nothing
 * real. `clientIp` (`lib/client-ip.ts`) is this route's first use of
 * `X-Forwarded-For` — see that module's own comment for the hop-count
 * assumption behind it.
 *
 * The body guard (Content-Length pre-check, streaming byte count, JSON parse,
 * and the `Connection: close` 413s) is `readBoundedJsonBody`
 * (`lib/request-body.ts`), shared with the auth routes; its own comment carries
 * the reasoning that used to be written out here.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');
  }

  // Who is submitting — see this file's own top comment. A database failure on
  // the registered-session lookup gets the same `rejectionResponse` shape as
  // every guard below, rather than a bare framework 500 with no `reason`;
  // nothing about the error is logged, only a fixed event name.
  let owner: OwnerActor | null;
  try {
    owner = await resolveOwnerActor((name) => request.cookies.get(name)?.value);
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'essay_submission_failed', stage: 'resolveOwner' }));
    return rejectionResponse('internalError', 500, 'could not submit essay');
  }
  if (!owner) {
    // Neither a live registered session nor a well-formed guest cookie. No
    // legitimate caller on the real path reaches this without a cookie
    // middleware already set moments earlier on the same navigation — see
    // this file's own comment above. Reject outright rather than resolving
    // (which would mean minting) a guest session for whoever this actually
    // is — and reject before the body is even read (round-2 review, see above).
    return rejectionResponse('invalidSessionCookie', 400, 'missing or invalid guest session cookie');
  }

  // KAN-25 / KAN-52 — see this file's own top comment for why this runs
  // exactly here: right after the actor guard (the earliest point an identity
  // to count against exists) and ahead of every body-reading step below.
  const rateLimitOk = await checkEssaySubmissionRateLimit(owner, clientIp(request));
  if (!rateLimitOk) {
    return rejectionResponse('rateLimited', 429, 'too many essay submissions — try again later');
  }

  const body = await readBoundedJsonBody(request);
  if (!body.ok) return body.response;
  const json = body.json;

  const parsed = essaySubmissionRequestSchema.safeParse(json);
  if (!parsed.success) {
    // KAN-15 (BR-1.7): "a blocked guest is told why, clearly, and never by
    // a generic error" — the two length-based failures (too short to
    // grade; over the 300-word hard ceiling) get their own message, read
    // off the schema's own `reason` (see essaySubmissionRequestSchema's
    // `.superRefine`), not a string match against its message text. In the
    // real guest flow this branch should never actually fire for a length
    // reason — EssayEntryForm runs the identical check client-side and
    // blocks the request before it's ever sent — so reaching it means the
    // request bypassed the browser; this is that independent server-side
    // enforcement, proven directly in route.test.ts with a request built
    // the same way. Every other rejection (empty content, over the
    // character safety cap) keeps the generic message below, unchanged
    // from KAN-14 — this route doesn't have a distinct guest-facing case
    // for either of those the way it does for the two length ones.
    //
    // Round-1 review (should-fix): `reason` used to stop here — the English
    // `message` went out, `reason` itself never left this function. The
    // client discarded the body entirely and rendered its own generic
    // `errorGeneric` string, so nothing about "a guest is told why" was
    // actually true of the shipped response; it only held in this route's
    // own tests, which read `parsed.error.issues` directly rather than the
    // HTTP body a real client gets. No user-visible effect today because
    // EssayEntryForm's identical client-side check blocks first — the only
    // way a real guest reaches this branch at all is a bypass — but a
    // German guest who DID reach it got an English sentence, and the
    // contract this route claims to expose was fiction past its own return
    // statement. Returning `reason` alongside `message` lets the caller
    // (EssayEntryForm) map it onto the already-translated string it
    // already holds (`strings.tooShortError`/`strings.tooLongError`)
    // instead of re-parsing English prose — the same shape KAN-16's own
    // grading failure reasons will need, cheaper to add now than to retrofit
    // once that lands.
    const lengthIssue = parsed.error.issues.find(
      (issue) => issue.code === 'custom' && isEssayLengthRejectionReason(issue.params?.reason),
    );
    // Round-2 review (Architect, blocking): this used to re-check `.code ===
    // 'custom'` here and then `as`-cast `.params?.reason` to the two known
    // reason strings — sound only because the `.find` predicate above
    // happened to check the same two strings inline, a fact the cast itself
    // could never verify. A third reason (grading, rate limiting) added to
    // the predicate above and not to the cast would compile cleanly and put
    // a value on the wire `EssayEntryForm`'s own narrowing doesn't recognise
    // either, silently dropped to the generic error. Narrowing against
    // `isEssayLengthRejectionReason` again here — the SAME exported check
    // the `.find` predicate above used, from `lib/contracts/essay-submission`
    // — replaces the cast with a real type guard: `reason` below is
    // `EssayLengthRejectionReason`, not `unknown` asserted into shape.
    if (lengthIssue && lengthIssue.code === 'custom' && isEssayLengthRejectionReason(lengthIssue.params?.reason)) {
      return rejectionResponse(lengthIssue.params.reason, 400, lengthIssue.message);
    }
    // KAN-31: everything the schema rejects that isn't one of the two length
    // reasons above — most commonly a missing/wrong-typed `content` field —
    // gets this one generic reason. It is deliberately not further split:
    // nothing downstream of this route acts differently on WHICH schema
    // constraint failed, only that the submission itself was invalid.
    return rejectionResponse('invalidSubmission', 400, 'invalid essay submission');
  }

  // KAN-24 (carried-over PR note, KAN-36-class fix): resolving the guest
  // session and the actual essay insert are wrapped in one try/catch.
  // `createEssay` (lib/db/essays.ts) can throw on a database failure with
  // nothing above it in the original call chain to catch it; an uncaught throw
  // here would become a bare framework 500 with no `reason`, and — before that
  // file's own KAN-24 fix — could have embedded a live guest session id
  // straight into the log line Next writes for an unhandled route error.
  // Catching here closes both: a database failure now gets exactly the same
  // `rejectionResponse` shape as every guard above, and nothing about `err`
  // itself (message, stack) is read or logged by this catch — only the fixed,
  // safe outcome string `logEssaySubmission` takes below.
  //
  // `submitter` is the actor the essay is stored under: for a registered user,
  // `owner` itself; for a guest, what `resolveGuestSession` resolved (which
  // differs from `owner` exactly when `reissued`). `owner` is what an error is
  // logged against, since it is the one identity guaranteed to exist here.
  let submitter: OwnerActor;
  let reissued = false;
  let essay: Awaited<ReturnType<typeof submitEssay>>;
  try {
    if (owner.kind === 'guest') {
      const resolved = await resolveGuestSession(owner.sessionId);
      submitter = resolved.actor;
      reissued = resolved.reissued;
    } else {
      submitter = owner;
    }
    essay = await submitEssay(submitter, parsed.data.content);
  } catch {
    logEssaySubmission(owner, parsed.data.content.length, 'error');
    return rejectionResponse('internalError', 500, 'could not submit essay');
  }

  logEssaySubmission(submitter, parsed.data.content.length, 'created');

  // KAN-16/ADR-2: enqueues asynchronous grading and returns as soon as the
  // job is SCHEDULED (see start-grading.ts's own comment). Deliberately its
  // own try/catch, separate from the one above: the essay itself is already
  // safely persisted by this point, so a failure to START grading (e.g. the
  // queue is unreachable) must not turn an otherwise-successful submission
  // into a 500 — the submitter keeps their saved essay either way. A job that
  // never got enqueued is visible later as a grading status poll stuck on
  // `pending`, not as a lost essay.
  try {
    await startGrading(submitter, essay.id);
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'grading_start_failed', submissionId: essay.id }));
  }

  const response = NextResponse.json({ id: essay.id }, { status: 201 });
  if (submitter.kind === 'guest' && reissued) {
    // Guest path only — see this file's own "trap the guest path exists to
    // close" comment above, and resolveGuestSession's `reissued` doc comment
    // (lib/domain/guest-session.ts) for the full case list this covers. Set to
    // the id the essay was actually stored under: `submitter.sessionId`, not
    // `essay.sessionId` (NULL when the essay belongs to an account).
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, submitter.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  return response;
}
