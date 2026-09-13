import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

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
export default createMiddleware(routing);

export const config = {
  matcher: ['/practice', '/practice/:path*', '/en/practice', '/en/practice/:path*', '/de/practice', '/de/practice/:path*'],
};
