/**
 * KAN-8 — Guest flow responsive foundation
 *
 * Runs across the configured Playwright projects (chromium-desktop,
 * chromium-mobile — see playwright.config.ts), which is what actually
 * proves AC1/AC2 ("renders and functions correctly on mobile web and
 * desktop web browsers... no native app; web-only, responsive layout"):
 * no manual viewport juggling needed, the project matrix already covers it.
 *
 * Only the landing page has real content today (the rest of the guest
 * flow — KAN-13 onward — nests under this same GuestFlowShell); this spec
 * is the seam future funnel specs (Test Strategy §5) extend rather than
 * duplicate.
 */
import { test, expect } from '@playwright/test';

test.describe('KAN-8 — /practice guest flow landing', () => {
  test('loads with no horizontal overflow at the current viewport', async ({ page }) => {
    await page.goto('/practice');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'page should not scroll horizontally').toBeLessThanOrEqual(clientWidth);
  });

  test('renders the step progress and the primary CTA', async ({ page }) => {
    await page.goto('/practice');

    await expect(page.getByRole('list', { name: /guest essay flow progress/i })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(5);

    const cta = page.getByRole('button', { name: /start practicing/i });
    await expect(cta).toBeVisible();
    // Intentionally disabled — see (guest)/practice/page.tsx: prompt
    // selection/essay entry (KAN-13/KAN-14) don't exist yet to link to.
    await expect(cta).toBeDisabled();
  });

  test('brand link in the flow header returns to the marketing homepage', async ({ page }) => {
    await page.goto('/practice');
    await page.getByRole('link', { name: /fluentina home/i }).click();
    await expect(page).toHaveURL('/');
  });

  test('zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/practice');
    await page.waitForLoadState('domcontentloaded');

    expect(errors, `Console errors on /practice:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
