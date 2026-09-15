import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';

/**
 * KAN-9 — locale negotiation/redirect for the guest flow ONLY.
 *
 * This story localises the guest essay flow, not the marketing site (see the
 * ticket's scope note) — the marketing pages, blog, placement test etc. stay
 * exactly as they are, English-only, unprefixed. Scoping the matcher to the
 * guest flow's own paths is what makes that true at the routing layer and
 * not just by convention: this middleware never runs for `/about`, `/blog`,
 * `/placement-test`, and so on, so nothing about how they resolve, redirect
 * or get indexed changes.
 *
 * Every entry appears twice — once with a leading `/de` prefix and once
 * without — because `localePrefix: 'as-needed'` means the default locale
 * (`en`) is reachable at the unprefixed path and German at the prefixed one;
 * the middleware itself decides which of those a request should end up at
 * (including redirecting away from the *prefixed* default-locale path, so
 * `/practice` and `/de/practice` are the only two canonical URLs and
 * `/en/practice` isn't a third one search engines could also index).
 */
const localeMiddleware = createMiddleware(routing);

/**
 * KAN-10 — guest session issuance, composed onto the same middleware.
 *
 * Next.js allows exactly one middleware module per app, and this one
 * already exists for locale routing (KAN-9), so issuing the session cookie
 * here means wrapping `localeMiddleware`'s response rather than replacing
 * it with a second, competing default export — both jobs run on every
 * request this file's `config.matcher` already covers, and only that one.
 *
 * Why here, and not a route handler or a Server Action minting the cookie
 * on its own: the guest flow's `/practice` page is statically prerendered
 * (KAN-9's own `setRequestLocale` work is what made that so), so nothing in
 * its render can set a per-visitor response header, and a route
 * handler/Server Action only runs when something — client JavaScript —
 * calls it, which the very first HTML response can't rely on. Middleware
 * runs ahead of every matched request regardless, so it's the only one of
 * the three legitimate homes (middleware, route handler, Server Action —
 * see the story) that can put a session cookie on a guest's first response,
 * JavaScript or not.
 *
 * What it deliberately does NOT do here is write to Postgres. Middleware
 * runs on the Edge runtime, and `lib/db/client.ts`'s `pg` driver needs a
 * real TCP connection Edge doesn't provide — attempting that import here
 * fails the build, not just the request. So this only ever mints an id and
 * sets a cookie; the corresponding `guest_sessions` row is created
 * separately, in a Node context, by `POST /api/guest-session` (see that
 * route's own comment for the other half of this split, and the KAN-10
 * commit message for why the split sits exactly here rather than, say,
 * abandoning the edge and moving cookie issuance into that same route).
 *
 * `generateGuestSessionId` (lib/domain/session-id.ts) had to move off
 * `node:crypto` for exactly this call site — Edge has no `node:crypto` — in
 * favour of the Web Crypto global, which is a CSPRNG in both runtimes; see
 * that file's own comment and its test asserting the swap actually
 * happened, not just something the comment claims.
 */
export default function middleware(request: NextRequest) {
  const response = localeMiddleware(request);

  const existingCookie = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  if (!guestSessionIdSchema.safeParse(existingCookie).success) {
    // Missing, or fails the exact format check `lib/db` re-parses before
    // ever using a session id as a primary key (see lib/contracts/actor.ts)
    // — a malformed or forged value is never trusted forward as-is; a
    // freshly generated one always replaces it.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, generateGuestSessionId(), GUEST_SESSION_COOKIE_OPTIONS);
  }
  // A syntactically valid cookie already present is left completely
  // untouched — no write, no re-issuance — which is what keeps a returning
  // guest's session id stable instead of rotating on every request.

  return response;
}

export const config = {
  // KAN-14: added the four /practice/write entries when that route landed
  // (essay entry) — src/middleware.test.ts walks the real route tree under
  // src/app/[locale]/(guest) and fails if this list and that tree ever
  // disagree, specifically so adding a guest route without updating this
  // array is a failing test here rather than a 404 in production.
  matcher: [
    '/practice',
    '/practice/:path*',
    '/en/practice',
    '/en/practice/:path*',
    '/de/practice',
    '/de/practice/:path*',
    '/practice/write',
    '/practice/write/:path*',
    '/en/practice/write',
    '/en/practice/write/:path*',
    '/de/practice/write',
    '/de/practice/write/:path*',
  ],
};
