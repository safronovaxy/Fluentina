import { NextRequest, NextResponse } from 'next/server';
import { submitEssay } from '@/lib/domain/essay-submission';
import { resolveGuestSession } from '@/lib/domain/guest-session';
import { essaySubmissionRequestSchema, MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';

/**
 * POST /api/essays — KAN-14, guest essay submission. Storage only: this
 * route persists the essay and reports its id back, nothing more. Grading
 * (KAN-16) and the recommended-length/word-count UI and its server-side
 * counterpart (KAN-15) are both separate stories that build on this
 * endpoint rather than being part of it — see `essaySubmissionRequestSchema`'s
 * own comment for the one seam KAN-15 extends here.
 *
 * Never logs the request body — see the `never log essay text` rule this
 * route is built against; nothing in this file (or anything it calls)
 * writes `content` anywhere but the one `createEssay` insert.
 *
 * Round-1 review (blocking): this route used to pass whatever raw cookie
 * value it read — `undefined` included — straight into `resolveGuestSession`
 * (via `submitEssay`), whose contract for a missing or malformed value is to
 * MINT a fresh session and create its row. That is the exact property
 * `/api/guest-session` (KAN-10) spent three review rounds removing — see
 * that route's own "review" comment for the full case for why minting on an
 * unauthenticated call is a real hole (a second, unauthenticated cookie
 * issuer; a forged call silently replacing a real guest's in-progress
 * session). This route reused the very primitive that guard exists to keep
 * away from an adapter, and its own `Set-Cookie` did the overwriting.
 *
 * This route now requires an already-well-formed cookie to do anything at
 * all, the same as `/api/guest-session`: a missing or malformed value is
 * rejected outright (400, nothing resolved, no row created), never minted.
 * By the time a real guest's browser reaches here, `src/middleware.ts` has
 * already minted and set a valid cookie on this exact navigation — see
 * `GuestSessionBootstrap`'s own comment for why this route still resolves
 * (rather than trusting a row already exists): an ad blocker, disabled
 * JavaScript, or a request that simply beat the bootstrap call would
 * otherwise leave a cookie with no `guest_sessions` row behind it, and the
 * essay insert would fail on the foreign key after a guest has already
 * written up to 300 words. That is a well-formed cookie naming no row YET —
 * resolution creates it. It is not the same case as no cookie at all, and
 * the false argument this comment used to make for treating them alike
 * (an ad blocker, or disabled JavaScript, "still presenting no cookie") does
 * not hold: both of those still present the well-formed cookie middleware
 * already set on the page response, because that happens server-side on the
 * same response the browser is rendering — nothing client-side has to run
 * for it to be there. The only real case a missing/malformed cookie covers
 * is a browser refusing to store it outright (e.g. WebKit refusing a
 * `__Host-`-prefixed cookie over plain HTTP), and minting does not help that
 * guest either: the reissued cookie in the response is refused the same
 * way, and their essay becomes an unreadable orphan until retention deletes
 * it. Rejecting is the more honest outcome, and the same one
 * `/api/guest-session` already reached.
 *
 * This route resolves the session itself (`resolveGuestSession`, imported
 * directly — not through `submitEssay`, which now only persists under an
 * already-resolved actor; see that function's own comment) rather than
 * trusting that `GuestSessionBootstrap` already ran, for the "no row yet"
 * reason above. Resolving here, once, and passing the result into
 * `submitEssay` also means this route always holds a validated `Actor`
 * before any rate limiting KAN-25 adds needs one — see that story's own
 * note.
 *
 * Trap this route exists to close (the Architect's own framing): if this
 * inserted the essay under whatever session id the browser's cookie
 * presented, rather than under the id `resolveGuestSession` actually
 * resolved to, a guest whose presented id named an unavailable session
 * (most often, one that already converted to a registered account) would
 * have their essay stored under an id their own browser is never told
 * about — unreadable by them, forever, until retention deletes it. Setting
 * the cookie below whenever `reissued` is true, to the exact id the essay
 * was actually stored under, is what avoids that; see `resolveGuestSession`'s
 * own `reissued` doc comment (lib/domain/guest-session.ts) for the rest of
 * this reasoning.
 *
 * The session actor comes from the cookie, and only the cookie — never from
 * the request body. `essaySubmissionRequestSchema` has no `sessionId`/
 * `userId` field and never will (see that schema's own comment); this route
 * does not read one off `parsed.data` for exactly that reason; a body field
 * naming a different, existing session is how any caller could attribute an
 * essay to a victim's session merely by naming it, with nothing reissued and
 * nothing for the real owner to notice (see route.test.ts's own test for
 * this).
 *
 * Same cross-origin guard as `src/app/api/guest-session/route.ts` — see that
 * route's own comment for the full reasoning this shares (extracted into
 * `lib/same-origin.ts` once this became the second route that needed it, as
 * that module's own KAN-10 review note said would happen). In short: the
 * guard is defence in depth against a forged `Origin`/forwarded-host pair,
 * not this route's actual authorisation — the mandatory, `SameSite=Lax`
 * session cookie (now that a caller presenting none is rejected, above) is
 * what a cross-site browser request cannot attach at all. Pinning the
 * comparison to a genuinely proxy-set value is KAN-28.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 400 });
  }

  // Checked before the raw request body is ever read, so a caller that
  // honestly reports a too-large Content-Length never gets buffered into
  // memory at all — see the byte-length check below for why this alone
  // isn't the whole story (a lying or absent Content-Length still reaches
  // it).
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: 'request body exceeds the safety limit' }, { status: 413 });
  }

  // A single, blunt safety cap on the raw request body — checked here,
  // against bytes, before the body is even parsed as JSON, specifically so
  // a pathologically large payload never reaches JSON.parse or the
  // database. This is the authority for a body whose Content-Length is
  // absent, wrong, or understates the truth — the check above is an
  // optimisation for the honestly-reported case, not a replacement for
  // this one. This is NOT the product's word-count rule (KAN-15 owns that,
  // against `content` itself, well below this number — see
  // essaySubmissionRequestSchema's own comment) and is deliberately far
  // more generous than any real essay could ever need.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: 'request body exceeds the safety limit' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = essaySubmissionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid essay submission' }, { status: 400 });
  }

  const rawCookie = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  if (!guestSessionIdSchema.safeParse(rawCookie).success) {
    // No legitimate caller on the real path reaches this without a cookie
    // middleware already set moments earlier on the same navigation — see
    // this file's own comment above. Reject outright rather than resolving
    // (which would mean minting) a session for whoever this actually is.
    return NextResponse.json({ error: 'missing or invalid guest session cookie' }, { status: 400 });
  }

  const { actor, reissued } = await resolveGuestSession(rawCookie);
  const essay = await submitEssay(actor, parsed.data.content);

  const response = NextResponse.json({ id: essay.id }, { status: 201 });
  if (reissued) {
    // See this file's own "trap this route exists to close" comment above,
    // and resolveGuestSession's `reissued` doc comment
    // (lib/domain/guest-session.ts) for the full case list this covers.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, essay.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  return response;
}
