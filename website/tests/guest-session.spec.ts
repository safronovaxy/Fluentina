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

const SESSION_COOKIE_NAME = 'fluentina_guest_session';

test.describe('KAN-10 — guest session cookie', () => {
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

  test('never readable from client JavaScript — HttpOnly excludes it from document.cookie', async ({ page }) => {
    await page.goto('/practice');

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

  test('the client-side bootstrap actually reaches the Node-context route handler', async ({ page }) => {
    // The middleware-minted cookie alone doesn't prove the guest_sessions
    // row exists — that write only happens once GuestSessionBootstrap's
    // POST /api/guest-session round-trips (see that component's own
    // comment for why the two are split across runtimes). Waiting on the
    // actual response is the one thing this spec can observe from outside
    // the app that the unit-level route/domain tests can't: that the
    // browser really does fire it, unprompted, on a plain page load.
    const ensureResponse = page.waitForResponse(
      (res) => res.url().endsWith('/api/guest-session') && res.request().method() === 'POST',
    );
    await page.goto('/practice');

    const response = await ensureResponse;
    expect(response.ok()).toBe(true);
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
