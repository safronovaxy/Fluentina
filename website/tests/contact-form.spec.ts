/**
 * T5 — Contact Form
 *
 * Verifies form validation, field behaviour, and submission flow.
 * Submission tests use real network — if Strapi is unavailable the
 * error-handling test verifies the form shows an error gracefully.
 */
import { test, expect } from '@playwright/test';
import { isCritical } from './helpers/console-errors';

test.describe('T5 — Contact form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contact');
    // Wait for form to be present
    await expect(page.locator('form')).toBeVisible();
  });

  test('T5.1 — Form fields are all present', async ({ page }) => {
    await expect(page.locator('input[name="name"], input[id="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"], input[id="email"]')).toBeVisible();
    await expect(page.locator('textarea[name="message"], textarea[id="message"]')).toBeVisible();
    // Subject select / combobox
    await expect(page.locator('select, button[role="combobox"]').first()).toBeVisible();
  });

  test('T5.2 — Validation: empty submit shows errors', async ({ page }) => {
    await page.getByRole('button', { name: /send|submit/i }).click();
    // At least one error message should appear
    const errors = page.locator('[role="alert"], .text-destructive, [class*="error"]');
    await expect(errors.first()).toBeVisible({ timeout: 3000 });
  });

  test('T5.3 — Validation: invalid email format', async ({ page }) => {
    await page.fill('input[name="email"], input[id="email"]', 'not-an-email');
    await page.getByRole('button', { name: /send|submit/i }).click();
    const errors = page.locator('[role="alert"], .text-destructive, [class*="error"]');
    await expect(errors.first()).toBeVisible({ timeout: 3000 });
  });

  test('T5.4 — Validation: message too short', async ({ page }) => {
    await page.fill('input[name="name"], input[id="name"]', 'Test User');
    await page.fill('input[name="email"], input[id="email"]', 'test@example.com');
    await page.fill('textarea[name="message"], textarea[id="message"]', 'Short');
    await page.getByRole('button', { name: /send|submit/i }).click();
    const errors = page.locator('[role="alert"], .text-destructive, [class*="error"]');
    await expect(errors.first()).toBeVisible({ timeout: 3000 });
  });

  test('T5.5 — Subject dropdown has 3 options', async ({ page }) => {
    const select = page.locator('select[name="subject"], select[id="subject"]');
    const combobox = page.locator('button[role="combobox"]').first();

    if (await select.count() > 0) {
      const options = await select.locator('option').count();
      expect(options).toBeGreaterThanOrEqual(3);
    } else if (await combobox.count() > 0) {
      await combobox.click();
      const items = page.locator('[role="option"]');
      // Was `toHaveCount(await items.count())` — a value asserted against
      // itself, which held for any count including zero.
      await expect(items.first()).toBeVisible();
      expect(await items.count()).toBeGreaterThanOrEqual(3);
    }
  });

});

/**
 * T5.6 — deliberately outside the describe block above, with no shared
 * `beforeEach`: this test used to reuse the shared `page` fixture, which
 * `beforeEach` had already navigated to `/contact` once, and then called
 * `page.goto('/contact')` a SECOND time itself (the only way to have
 * something for its own listener to observe, since it attaches after
 * `beforeEach` already ran). That second navigation tore down the first
 * page while a Next.js `<Link>` prefetch it had kicked off was still in
 * flight — KAN-30 review: reproduced directly, 13 failures in 25 repeats on
 * `webkit-desktop`, 0 in 25 on `chromium-desktop`. WebKit (not Chromium)
 * logs the aborted fetch as a page console error ("Failed to fetch RSC
 * payload for .../TypeError: Load failed"), which then landed on the
 * SECOND page's listener because it resolves asynchronously, after that
 * navigation had already started. Chromium's Falling back to browser
 * navigation happens too, but doesn't log an error the same way.
 *
 * A single navigation, with the listener attached first — never a second
 * page to tear down — doesn't reproduce it: 0 failures in 25 repeats on
 * `webkit-desktop`. That's this test now, and it's the same shape
 * tests/guest-flow.spec.ts's own "zero console errors" test already uses:
 * listeners attached, then exactly one navigation, `networkidle` (not
 * `domcontentloaded`, which fires before hydration — see that file's own
 * comment) before asserting, and `pageerror` filtered through `isCritical`
 * too, not just `console`, so an uncaught exception (the way CookieYes'
 * unregistered-origin error actually arrives — see helpers/console-errors.ts)
 * isn't silently missed.
 *
 * KAN-30 round-1 review (should-fix): moving this out of the describe block
 * above to drop the double navigation also dropped the shared beforeEach's
 * `expect(page.locator('form')).toBeVisible()` assertion. The test is named
 * for the form rendering, and had come to assert only a successful response
 * and no console errors — a page that returns 200 and renders no form at
 * all would still pass it. Restored below, after the load wait, without
 * reintroducing a second navigation.
 */
test.describe('T5 — Contact form (console errors)', () => {
  test('T5.6 — Form renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      if (isCritical(err.message)) errors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isCritical(msg.text())) errors.push(msg.text());
    });

    const response = await page.goto('/contact');
    expect(response?.ok(), `/contact should respond 200, got ${response?.status()}`).toBe(true);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('form')).toBeVisible();

    expect(errors, `Console errors on /contact:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
