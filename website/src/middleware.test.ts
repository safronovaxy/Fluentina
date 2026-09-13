import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './middleware';
import { routing } from './i18n/routing';

/**
 * KAN-9 — a review found the middleware matcher is a hand-maintained
 * allowlist: probed by adding a route directory without touching the
 * matcher, `/preview` 404'd while `/de/preview` and `/en/preview` kept
 * working. That's the primary, unprefixed URL for most guests silently
 * breaking the moment a future guest-flow story (KAN-13 prompt selection
 * through KAN-20/21 registration) adds its route and its author doesn't
 * separately remember to update `middleware.ts`.
 *
 * Rather than deriving the matcher at build time (Next.js requires
 * `config.matcher` to be statically analysable — no `fs` calls at that
 * point), this walks the real route tree under `src/app/[locale]/(guest)`
 * and asserts the matcher covers every route it finds, in every configured
 * locale, so a forgotten update is a failing test here instead of a 404 a
 * guest hits in production. A derived matcher was considered and rejected
 * for that reason — this is the "cheaper than a clever pattern" option the
 * review suggested.
 */
const GUEST_APP_DIR = path.join(process.cwd(), 'src', 'app', '[locale]', '(guest)');

/** Recursively finds every route path under `dir` that has its own page.tsx. */
function findGuestRoutes(dir: string, segments: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const isRoute = entries.some((entry) => entry.isFile() && /^page\.(t|j)sx?$/.test(entry.name));
  const routes = isRoute ? [`/${segments.join('/')}`] : [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Route groups, e.g. "(guest)" itself, contribute no URL segment.
    const isRouteGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
    const nextSegments = isRouteGroup ? segments : [...segments, entry.name];
    routes.push(...findGuestRoutes(path.join(dir, entry.name), nextSegments));
  }
  return routes;
}

/**
 * The matcher shape `src/middleware.ts` uses today for `/practice`: the
 * unprefixed route plus its `:path*` catch-all once, and both again under
 * every configured locale's prefix (including the default locale's — see
 * routing.ts for why the prefixed default-locale entries exist: they're
 * what the middleware redirects *away from*).
 */
function expectedMatchers(guestRoutes: string[]): string[] {
  return guestRoutes.flatMap((route) => [
    route,
    `${route}/:path*`,
    ...routing.locales.flatMap((locale) => [`/${locale}${route}`, `/${locale}${route}/:path*`]),
  ]);
}

describe('middleware matcher covers every guest route in every locale (KAN-9)', () => {
  it('matches the actual route tree under src/app/[locale]/(guest)', () => {
    const guestRoutes = findGuestRoutes(GUEST_APP_DIR);
    // Sanity check on the walker itself — if this is empty the test below
    // passes for the wrong reason (two empty sets are equal).
    expect(guestRoutes.length).toBeGreaterThan(0);

    const expected = new Set(expectedMatchers(guestRoutes));
    const actual = new Set(config.matcher);
    expect(actual).toEqual(expected);
  });
});
