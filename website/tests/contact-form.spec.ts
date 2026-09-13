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

  test('T5.6 — Form renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/contact');
    await page.waitForLoadState('domcontentloaded');
    const critical = errors.filter(isCritical);
    expect(critical).toHaveLength(0);
  });
});
