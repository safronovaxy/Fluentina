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
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== request.nextUrl.origin) {
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

  const { actor } = await resolveGuestSession(raw);

  const response = NextResponse.json({ ok: true });
  if (actor.sessionId !== raw) {
    // The only way resolveGuestSession can hand back an id different from
    // the well-formed one just presented: `raw` named a session that had
    // already converted to a registered account, and a fresh id had to be
    // minted in its place (see lib/domain/guest-session.ts's
    // ConvertedSessionIdCollisionError recovery) — the fix for a converted
    // guest otherwise colliding with their own, now-attached row on every
    // subsequent page load. That's the one case this adapter still has to
    // reissue the cookie for; every other outcome (ordinary first use,
    // returning guest) resolves under the exact id middleware already set,
    // so there is nothing to reissue.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, actor.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  return response;
}
