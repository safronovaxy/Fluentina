/**
 * T10 (partial) — Zero console errors on all marketing pages
 *
 * Catches hydration errors, missing module errors, and runtime crashes
 * that would be invisible to HTTP status checks.
 *
 * Hydration errors in Next.js look like:
 *   "Error: Hydration failed because the initial UI does not match..."
 *   "Warning: Expected server HTML to contain a matching..."
 */
import { test, expect } from '@playwright/test';
import { STATIC_MARKETING_ROUTES } from './helpers/routes';
import { isCritical } from './helpers/console-errors';

for (const route of STATIC_MARKETING_ROUTES) {
  test(`T10 — ${route} has zero console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && isCritical(msg.text())) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      if (isCritical(err.message)) {
        errors.push(`[pageerror] ${err.message}`);
      }
    });

    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');

    expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toHaveLength(0);
  });
}

test('T10 — No hydration errors on homepage', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Hydration') || text.includes('hydration') || text.includes('did not match')) {
      hydrationErrors.push(text);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(
    hydrationErrors,
    `Hydration errors found:\n${hydrationErrors.join('\n')}`,
  ).toHaveLength(0);
});
