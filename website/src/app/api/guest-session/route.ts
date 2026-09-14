import { NextRequest, NextResponse } from 'next/server';
import { resolveGuestSession } from '@/lib/domain/guest-session';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';

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
 * The header is trustworthy here even though it's client-supplied: a
 * cross-site attacker cannot set `X-Forwarded-Host` on a browser `fetch`
 * without it becoming a non-simple request, which triggers a CORS preflight
 * -- and this route answers no `OPTIONS` handler, so that preflight fails
 * before the forged header ever arrives. The stricter alternative, an
 * explicitly configured `APP_ORIGIN` env var compared instead of any
 * header, is deferred to KAN-28: it needs production wiring, and a missing
 * value would fail closed in exactly the silent way this fix exists to
 * close.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== null && originHost(origin) !== forwardedHost(request)) {
    // A same-origin fetch either omits Origin (older browsers, some
    // same-origin requests) or sends the page's own origin; a cross-site
    // caller sends its own. Only reject when it's present and WRONG, not
    // merely absent — absence alone isn't evidence of anything here.
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 400 });
  }

  const raw = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  if (!guestSessionIdSchema.safeParse(raw).success) {
    // No legitimate caller on the real path reaches this without a cookie
    // middleware already set moments earlier on the same navigation — see
    // the comment above. Reject outright rather than resolving a session
    // (which would mean minting one) for whoever this actually is.
    return NextResponse.json({ error: 'missing or invalid guest session cookie' }, { status: 400 });
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

/**
 * The host `Origin` claims to be from, or `null` if `Origin` isn't even a
 * parseable URL (a malformed header is treated as a mismatch by the caller,
 * never as "absent" — only a genuinely missing header gets that pass).
 */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * The host this request actually arrived at, from the proxy's point of
 * view. `x-forwarded-host` first — Cloud Run's load balancer sets it to the
 * public hostname the browser actually connected to — falling back to
 * `host` for local dev and any other deployment shape without a proxy in
 * front. Deliberately not `request.nextUrl.host`: see the route's own
 * comment above for why that's the container bind address, not this.
 */
function forwardedHost(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}
