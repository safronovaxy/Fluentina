import { NextRequest, NextResponse } from 'next/server';
import { resolveGuestSession } from '@/lib/domain/guest-session';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';
import type { RejectionReason } from '@/lib/contracts/rejection-reason';

/**
 * POST /api/guest-session — KAN-10 session issuance, the Node-runtime half.
 *
 * `src/middleware.ts` (Edge) mints the bearer id and sets it as a cookie on
 * every guest-flow response, including the very first page load — so a
 * guest has an identifier from the first HTTP response, even before any
 * client JavaScript has run. What that middleware cannot do, running on the
 * Edge runtime, is write the corresponding `guest_sessions` row:
 * `lib/db/client.ts`'s `pg` driver needs a real TCP connection Edge doesn't
 * provide. This route is that missing Node-runtime half — Route Handlers
 * run on the Node.js runtime by default (no `export const runtime = 'edge'`
 * here), which is what actually makes calling `lib/domain` → `lib/db` safe.
 *
 * Called once, client-side, on the guest flow's first paint — see
 * `GuestSessionBootstrap` — which is the "on first use" this route exists
 * for: it reads back whatever cookie the browser is already carrying (set
 * by middleware moments earlier, on the very same navigation) and creates
 * its row if one doesn't exist yet.
 *
 * This is the one adapter that touches the actual `Set-Cookie` header for
 * this cookie, alongside middleware.ts — `resolveGuestSession` itself
 * (lib/domain) never sees a cookie, only the plain string pulled out of it
 * here and the plain values it hands back (ADR-14).
 *
 * The response body carries nothing about the session — the id is
 * HttpOnly and stays that way; there is no reason for client JavaScript to
 * ever see it, in the response body any more than in `document.cookie`.
 *
 * Review: this route used to mint a brand-new session for anyone who called
 * it with no cookie, or a malformed one — including a cross-site page, with
 * credentials, in a loop. Same-site rules stop the browser from attaching a
 * visitor's OWN cookie to a cross-site request, but never stop the request
 * itself, so that was a second, unauthenticated cookie issuer reachable by
 * anyone: no rate limit, no ownership check, one new `guest_sessions` row
 * per call, and — worse — for a real guest mid-essay, a forged call like
 * that would silently replace their session cookie with a fresh one,
 * severing whatever they'd already written under the old one.
 *
 * Middleware is now the only issuer. This route requires an
 * already-well-formed cookie to do anything at all, and rejects same-origin
 * requests too, rather than mint one of its own: by the time
 * `GuestSessionBootstrap`'s fetch actually reaches here, middleware has
 * already run on this exact navigation and put a valid cookie on the
 * browser — that's the only real path, and it always presents a cookie that
 * already passes `guestSessionIdSchema`. `src/middleware.ts`'s own mint
 * branch (malformed/missing cookie → fresh id) is left alone; that is its
 * contract, not this route's.
 *
 * Review (round 2): the cross-origin check used to compare `Origin` against
 * `request.nextUrl.origin` -- which is wrong in exactly the deployed shape
 * this route runs in. The `output: standalone` server builds its own URL
 * from the container bind address (`HOSTNAME`/`PORT`, `trustHostHeader:
 * false`), not from any header a real request carries, so on Cloud Run
 * `request.nextUrl.origin` is always `https://0.0.0.0:8080` -- a value no
 * browser can ever send as `Origin`. Every real guest's first POST was
 * rejected 400, silently: no row, no log. `request.nextUrl` must never be
 * read for host or origin anywhere in this route; compare HOSTS instead,
 * using the forwarded/Host header, the same thing Next's own Server Action
 * CSRF check does.
 *
 * `x-forwarded-host` is client-supplied and NOT trusted: we front Cloud Run
 * with a Google external Application Load Balancer over serverless NEGs,
 * which manages `x-forwarded-for` and `x-forwarded-proto` and preserves
 * `Host` -- but it does not set or strip `x-forwarded-host`, and nothing in
 * this repo does either, so whatever a caller sends arrives here verbatim.
 * A caller that can set its own headers can therefore satisfy this check
 * against itself. Measured directly against the real standalone build:
 * `Origin: https://evil.example` plus `X-Forwarded-Host: evil.example`
 * (`Host: fluentina.com`) returns 200.
 *
 * That makes this guard defence in depth against BROWSER-DRIVEN cross-site
 * requests only, where the header genuinely can't be forged: setting
 * `X-Forwarded-Host` turns the fetch into a non-simple request, which
 * triggers a CORS preflight, and this route answers no `OPTIONS` handler
 * (asserted directly in route.test.ts), so that preflight goes unanswered
 * and the real request with the forged header never arrives.
 *
 * The property actually protecting this route is the session cookie being
 * `SameSite=Lax` and mandatory (GUEST_SESSION_COOKIE_OPTIONS): a browser
 * attaches a Lax cookie to no cross-site POST, so a cross-site attacker is
 * rejected here for carrying no cookie at all, regardless of what it
 * claims about Origin or forwarded host. Neutralise this Origin check
 * entirely and an attacker gains nothing they cannot already get today by
 * simply omitting `Origin`, which has always been accepted.
 *
 * Pinning the comparison to a genuinely proxy-set value, or to a
 * configured origin allowlist, is KAN-28. Do not treat `forwardedHost` as
 * a reusable trusted primitive elsewhere in this codebase -- KAN-14's
 * submission path (`src/app/api/essays/route.ts`) turned out to be exactly
 * that next place, and reuses this same check via `lib/same-origin.ts`
 * (extracted there, once a second call site needed it, rather than
 * duplicated) -- with the same caveat carried on that module instead of
 * repeated per call site.
 *
 * KAN-31: both rejections below now carry a `reason` code (`crossOrigin` /
 * `invalidSessionCookie`) alongside their unchanged status and message —
 * the same `lib/contracts/rejection-reason.ts` union `/api/essays` draws
 * from, since both routes' guards for these two are the exact same check.
 * See that module's own comment for why this exists at all, and
 * route.test.ts for the tests asserting `reason` on both branches.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    // A same-origin fetch either omits Origin (older browsers, some
    // same-origin requests) or sends the page's own origin; a cross-site
    // caller sends its own. See `isCrossOriginRequest`'s own doc comment
    // for exactly what counts as a mismatch, including the "absence on
    // both sides is not a match" case a round-2 review found missing here.
    return NextResponse.json({ error: 'cross-origin request rejected', reason: 'crossOrigin' satisfies RejectionReason }, { status: 400 });
  }

  const raw = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  if (!guestSessionIdSchema.safeParse(raw).success) {
    // No legitimate caller on the real path reaches this without a cookie
    // middleware already set moments earlier on the same navigation — see
    // the comment above. Reject outright rather than resolving a session
    // (which would mean minting one) for whoever this actually is.
    return NextResponse.json(
      { error: 'missing or invalid guest session cookie', reason: 'invalidSessionCookie' satisfies RejectionReason },
      { status: 400 },
    );
  }

  const { actor, reissued } = await resolveGuestSession(raw);

  const response = NextResponse.json({ ok: true });
  if (reissued) {
    // The only way resolveGuestSession hands this back true for a
    // well-formed cookie: `raw` named a session that's no longer available
    // as a guest session (see lib/domain/guest-session.ts's
    // `SessionIdUnavailableError` recovery — converted to a registered
    // account, or deleted since) and a fresh id had to be minted in its
    // place. That's the one case this adapter still has to reissue the
    // cookie for; every other outcome (ordinary first use, returning guest)
    // resolves under the exact id middleware already set, so there is
    // nothing to reissue.
    //
    // Review (round 2): this used to compare `actor.sessionId !== raw`
    // itself instead of reading `reissued` off the domain result — the
    // exact rediscovery-by-string-comparison `reissued`'s own doc comment
    // warns the next caller (KAN-14's submission path) away from repeating.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, actor.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  return response;
}
