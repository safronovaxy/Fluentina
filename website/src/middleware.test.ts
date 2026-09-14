import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import middleware, { config } from './middleware';
import { routing } from './i18n/routing';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';

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

/**
 * Dynamic segments are deliberately rejected rather than translated.
 *
 * A directory named `[id]` produces the route path `/essay/[id]`, and that
 * string is not matcher syntax — it only ever matches the literal characters
 * `[id]`. Verified end to end: adding such a route, then adding exactly what
 * this test asked for, gave a green test, a green build, and `/essay/42`
 * returning 404 while `/de/essay/42` returned 200. That is the original
 * defect this test exists to prevent, except with the test actively telling
 * the author they were finished.
 *
 * Translating `[id]` to `:id` would work, but it would quietly hand a
 * generated matcher entry to someone who never looked at it. Failing loudly
 * and asking for a hand-written entry is the honest option, and dynamic
 * guest routes are rare enough that the cost is a sentence in a test.
 */
function assertNoDynamicSegments(routes: string[]): void {
  const dynamic = routes.filter((route) => route.includes('['));
  if (dynamic.length > 0) {
    throw new Error(
      `Dynamic guest route(s) found: ${dynamic.join(', ')}.\n` +
        `A path containing [brackets] is not middleware matcher syntax — it ` +
        `matches those literal characters and nothing else, so the unprefixed ` +
        `URL would 404 in production while the prefixed one worked.\n` +
        `Write the matcher entry by hand (e.g. '/essay/:id'), then extend ` +
        `this test to cover it.`,
    );
  }
}

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
    assertNoDynamicSegments(guestRoutes);

    const expected = new Set(expectedMatchers(guestRoutes));
    const actual = new Set(config.matcher);
    expect(actual).toEqual(expected);
  });

  it('refuses a dynamic guest route rather than generating a matcher that 404s', () => {
    // Without this, adding `(guest)/essay/[id]` and then adding exactly what
    // the test asked for produced a green test, a green build, and
    // /essay/42 returning 404 while /de/essay/42 returned 200.
    expect(() => assertNoDynamicSegments(['/practice', '/essay/[id]'])).toThrow(
      /Dynamic guest route\(s\) found: \/essay\/\[id\]/,
    );
    expect(() => assertNoDynamicSegments(['/practice', '/essay/[id]'])).toThrow(
      /Write the matcher entry by hand/,
    );
    expect(() => assertNoDynamicSegments(['/practice'])).not.toThrow();
  });
});

function requestWithCookie(path: string, cookieValue?: string): NextRequest {
  const headers = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL(`http://localhost:3000${path}`), { headers });
}

describe('middleware — KAN-10 guest session cookie, composed onto KAN-9 locale routing', () => {
  it('a first visit (no cookie) gets a session cookie minted at the edge', () => {
    const response = middleware(requestWithCookie('/practice'));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);
  });

  it('the cookie carries HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime — a bearer credential, never readable by client JavaScript, that outlives the browser session to match the guest data retention window', () => {
    const response = middleware(requestWithCookie('/practice'));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it('is named with the __Host- prefix — the browser itself refuses to store it without Secure, no Domain, and Path=/, closing the fixation route a signature would not', () => {
    const response = middleware(requestWithCookie('/practice'));

    expect(GUEST_SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeDefined();
  });

  it('a returning guest with a valid cookie keeps it — no Set-Cookie at all', () => {
    const existing = generateGuestSessionId();

    const response = middleware(requestWithCookie('/practice', existing));

    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('a malformed or forged cookie value is never carried forward — a fresh one replaces it', () => {
    const forged = 'attacker-supplied-value';

    const response = middleware(requestWithCookie('/practice', forged));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.value).not.toBe(forged);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);
  });

  it('rejects a well-formed-length but uppercase cookie the same way — the format is lowercase hex only', () => {
    const uppercase = generateGuestSessionId().toUpperCase();

    const response = middleware(requestWithCookie('/practice', uppercase));

    // Same shape as the forged-value test above, deliberately: asserting
    // only `cookie?.value !== uppercase` holds trivially when no cookie is
    // set at all (`undefined !== uppercase`) — precisely the regression this
    // test exists to catch. A mutant that lowercases the input before
    // validating (so the uppercase cookie "passes" and is carried forward
    // unchanged, defeating the case-sensitivity check) satisfied that
    // weaker assertion on every one of this file's nine tests.
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(uppercase);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);
  });

  it('still issues a session cookie on a locale redirect (/en/practice -> /practice) — the two jobs compose rather than one replacing the other', () => {
    const response = middleware(requestWithCookie('/en/practice'));

    // KAN-9's own behaviour survives unchanged: the prefixed default-locale
    // path still redirects to the unprefixed canonical one.
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/practice');
    // ...and KAN-10's cookie still gets set on that same redirect response,
    // proving this wraps next-intl's response rather than only handling
    // the plain pass-through case.
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);
  });

  it('still issues a session cookie on a locale rewrite (/de/practice) alongside next-intl’s own NEXT_LOCALE cookie', () => {
    const response = middleware(requestWithCookie('/de/practice'));

    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('de');
    const sessionCookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(guestSessionIdSchema.safeParse(sessionCookie?.value).success).toBe(true);
  });
});
