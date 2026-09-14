import { NextRequest, NextResponse } from 'next/server';
import { resolveGuestSession } from '@/lib/domain/guest-session';
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
 */
export async function POST(request: NextRequest) {
  const raw = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  const { actor, isNew } = await resolveGuestSession(raw);

  const response = NextResponse.json({ ok: true });
  if (isNew) {
    // Either there was no cookie, or the one presented didn't parse as a
    // GuestSessionId (malformed or forged) — either way, `resolveGuestSession`
    // already minted a fresh id rather than trusting it, and that fresh id
    // has to replace whatever the guest's browser was holding.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, actor.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  // A returning guest (valid cookie, row already existed) gets no
  // Set-Cookie at all — nothing to reissue, nothing written.
  return response;
}
