/**
 * KAN-10 — guest session issuance, end to end.
 *
 * The other KAN-10 tests (src/middleware.test.ts, src/lib/domain/
 * guest-session.test.ts, src/app/api/guest-session/route.test.ts) exercise
 * each half of the split (edge mint + cookie, Node-context row creation)
 * directly, unit-level. This spec is the one place that proves the two
 * halves actually compose in a real running app: a real browser, hitting
 * the real middleware over a real HTTP connection, then running the real
 * client-side bootstrap that calls the real route handler — nothing here is
 * called directly.
 */
import { test, expect } from '@playwright/test';

// `__Host-` prefixed per review: the browser itself refuses to store a
// cookie under this name unless it also carries Secure, no Domain
// attribute, and Path=/ — see lib/guest-session-cookie.ts's own comment for
// why that's the actual defence against a cookie planted from the CMS's
// sibling subdomain, not signing.
const SESSION_COOKIE_NAME = '__Host-fluentina_guest_session';

// Chromium (and Firefox) treat "localhost" as a secure context and honour
// `Secure` cookies there even over plain HTTP. WebKit doesn't: probed
// directly (round 2 review) with three cookies set over plain
// `http://localhost:8080/` — a bare cookie, a `Secure` one, and a
// `__Host-`-prefixed one — only the bare cookie was stored; BOTH of the
// other two, `Secure` alone as much as `__Host-`, were silently dropped.
// The same probe over `https://localhost:8443/`, including with an
// untrusted self-signed cert, stored all three, `__Host-` included. So the
// cause is `Secure` over plain HTTP, full stop — `__Host-` implies `Secure`
// and is incidental here, not an extra WebKit restriction of its own; an
// earlier version of this comment blamed `__Host-` specifically, which is
// what a reader would have "fixed" by dropping the prefix, a real security
// regression that would not have made WebKit pass anyway (the bare
// `Secure` attribute alone already fails the same way). Production always
// serves HTTPS, so this is an artifact of testing over plain HTTP
// locally/in CI, not a defect in the cookie: the review's own instruction
// is to keep the prefix and adjust the test, not drop it.
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isPlainHttp = BASE_URL.startsWith('http://');

test.describe('KAN-10 — guest session cookie', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === 'webkit-desktop' && isPlainHttp,
      'WebKit refuses to store a __Host--prefixed cookie over plain HTTP, even on localhost — see the comment above SESSION_COOKIE_NAME. Runs against HTTPS (test:e2e:live) are not skipped.',
    );
  });

  test('a first visit gets a session cookie, HttpOnly/Secure/SameSite=Lax/Path=/', async ({ page, context }) => {
    const response = await page.goto('/practice');
    expect(response?.ok()).toBe(true);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);

    expect(sessionCookie, 'session cookie should be set on first visit').toBeDefined();
    expect(sessionCookie?.value).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');
    expect(sessionCookie?.path).toBe('/');
  });

  test('never readable from client JavaScript — HttpOnly excludes it from document.cookie', async ({ page, context }) => {
    await page.goto('/practice');

    // Review (round 2): this assertion holds trivially, and for the wrong
    // reason, in a browser that refused to store the cookie at all — it was
    // the one test in this file that still passed under WebKit-over-plain-
    // HTTP, precisely because there, `document.cookie` not containing it and
    // `context.cookies()` not containing it were the same fact. Pinning that
    // the cookie really was set is what makes "and yet unreadable" mean
    // anything.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeDefined();

    const documentCookie = await page.evaluate(() => document.cookie);
    expect(documentCookie).not.toContain(SESSION_COOKIE_NAME);
  });

  test('a returning guest keeps the same session id — reloading does not rotate it', async ({ page, context }) => {
    await page.goto('/practice');
    const first = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value;
    expect(first).toBeDefined();

    await page.reload();
    const second = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value;

    expect(second).toBe(first);
  });

  test('the client-side bootstrap actually reaches the Node-context route handler, for the exact session middleware minted', async ({
    page,
    context,
  }) => {
    // The middleware-minted cookie alone doesn't prove the guest_sessions
    // row exists — that write only happens once GuestSessionBootstrap's
    // POST /api/guest-session round-trips (see that component's own
    // comment for why the two are split across runtimes). Waiting on the
    // actual response is one thing this spec can observe from outside the
    // app that the unit-level route/domain tests can't: that the browser
    // really does fire it, unprompted, on a plain page load.
    //
    // That alone only proves SOME POST landed and returned 200 — not that
    // it was authenticated with the SAME id middleware just set (the route
    // handler deliberately never echoes the id back in its response body,
    // per the "never leaks the session id" rule, so the response can't be
    // asked directly). Comparing the cookie before the request and after
    // it resolves, plus the Cookie header the request itself actually
    // carried, is the one way this browser-level test — and only this
    // one — can show the row belongs to the identifier middleware minted,
    // not a coincidentally separate one.
    const ensureRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/guest-session') && req.method() === 'POST',
    );
    const ensureResponse = page.waitForResponse(
      (res) => res.url().endsWith('/api/guest-session') && res.request().method() === 'POST',
    );
    await page.goto('/practice');

    const cookieBefore = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value;
    expect(cookieBefore).toBeDefined();

    const [request, response] = await Promise.all([ensureRequest, ensureResponse]);
    expect(response.ok()).toBe(true);
    expect(await request.headerValue('cookie')).toContain(`${SESSION_COOKIE_NAME}=${cookieBefore}`);

    const cookieAfter = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value;
    expect(cookieAfter).toBe(cookieBefore);
  });

  test('the guest session cookie is still set alongside a locale redirect (/en/practice -> /practice)', async ({
    page,
    context,
  }) => {
    const response = await page.goto('/en/practice');
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL('/practice');

    const sessionCookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie?.value).toMatch(/^[0-9a-f]{32}$/);
  });
});
