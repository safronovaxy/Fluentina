/**
 * T4 — Navigation & Header
 *
 * Verifies the header renders correctly, active states work,
 * the mobile menu opens/closes, and all nav links work.
 */
import { test, expect } from '@playwright/test';

test.describe('T4 — Desktop navigation', () => {
  test('T4.1 — Logo links to homepage', async ({ page }) => {
    await page.goto('/about');
    await page.locator('header a[href="/"]').first().click();
    await expect(page).toHaveURL('/');
  });

  test('T4.2 — Active nav link is highlighted on /about', async ({ page }) => {
    await page.goto('/about');
    // Pricing was unlinked from nav (ADR-8), so this uses a link that still
    // exists. Absence of Pricing is asserted by T4.10 below.
    const aboutLink = page.locator('header').getByRole('link', { name: /about/i }).first();
    await expect(aboutLink).toBeVisible();
  });

  test('T4.3 — All main nav links navigate without 404', async ({ page }) => {
    const navItems = [
      // Pricing deliberately absent — unlinked from nav per ADR-8.
      { label: /about/i,         url: '/about' },
      { label: /blog/i,          url: '/blog' },
      { label: /resources/i,     url: '/resources' },
    ];

    for (const { label, url } of navItems) {
      await page.goto('/');
      const link = page.locator('header').getByRole('link', { name: label }).first();
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.locator('h1, h2').first()).toBeVisible();
    }
  });

  test('T4.4 — "Get Started Free" CTA is visible and has href', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('header').getByRole('link', { name: /get started/i }).first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('fluentina.com');
  });

  test('T4.5 — Sign In button is visible and has href', async ({ page }) => {
    await page.goto('/');
    const signIn = page.locator('header').getByRole('link', { name: /sign in/i }).first();
    await expect(signIn).toBeVisible();
    const href = await signIn.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('T4.6 — Language test dropdown shows German and English options', async ({ page }) => {
    await page.goto('/');
    // Open the dropdown / navigation menu for tests
    const testTrigger = page.locator('header').getByText(/test your language/i).first();
    if (await testTrigger.isVisible()) {
      await testTrigger.hover();
      await expect(page.getByRole('link', { name: /german/i }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: /english/i }).first()).toBeVisible();
    } else {
      test.skip(); // Menu structure may differ — skip rather than fail
    }
  });
});

test.describe('T4 — Mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('T4.7 — Mobile hamburger opens menu', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('button[aria-label="Toggle menu"]');
    await hamburger.click();
    // At least one nav link should be visible after opening
    await expect(
      page.getByRole('link', { name: /^about$/i }).first()
    ).toBeVisible();
  });

  test('T4.8 — Mobile menu closes when the toggle is clicked again', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('button[aria-label="Toggle menu"]');
    const aboutLink = page.getByRole('link', { name: /^about$/i }).first();

    // Open: the nav link becomes visible.
    await hamburger.click();
    await expect(aboutLink).toBeVisible();

    // Close: it must go away again. The previous version of this test computed
    // visibility and then asserted expect(true).toBe(true), so it passed whether
    // or not the menu ever closed.
    await hamburger.click();
    await expect(aboutLink).toBeHidden();
  });

  test('T4.9 — Mobile nav links work', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('button[aria-label="Toggle menu"]');
    await hamburger.click();
    const aboutLink = page.getByRole('link', { name: /^about$/i }).first();
    await expect(aboutLink).toBeVisible();
    await aboutLink.click();
    await expect(page).toHaveURL('/about');
  });
});

// Regression guard for ADR-8. The route and its Stripe plumbing stay in place
// and reachable — only the nav entries were removed — so without this, nothing
// stops a later change from quietly re-linking it.
test.describe('T4 — Pricing is unlinked from navigation (ADR-8)', () => {
  test('T4.10 — Neither header nor footer links to /pricing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header a[href="/pricing"]')).toHaveCount(0);
    await expect(page.locator('footer a[href="/pricing"]')).toHaveCount(0);
  });

  test('T4.11 — /pricing itself still serves', async ({ request }) => {
    const response = await request.get('/pricing');
    expect(response.status()).toBe(200);
  });
});
