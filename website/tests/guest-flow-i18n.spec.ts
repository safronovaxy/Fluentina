/**
 * KAN-9 — i18n architecture, guest flow
 *
 * The guest essay flow ((guest), under src/app/[locale]/) is this story's
 * worked example: locale routing/switching for EN and DE, proven at the
 * browser level on the actual landing page, not just asserted in a unit
 * test against a mocked provider.
 *
 * Deliberately does NOT touch any marketing page — that is this story's
 * scope boundary (see the ticket and next-intl config comments). routing.
 * spec.ts / seo.spec.ts / sitemap.spec.ts already cover that marketing stays
 * exactly as it was; this file only adds assertions for the surface that
 * changed.
 */
import { test, expect } from '@playwright/test';
import { isCritical } from './helpers/console-errors';

test.describe('KAN-9 — guest flow renders in both locales', () => {
  test('English at /practice (no locale prefix — the default locale stays where it already was)', async ({
    page,
  }) => {
    await page.goto('/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Practice a B2-style essay',
    );
    await expect(page.getByRole('button', { name: /start practicing/i })).toBeVisible();
  });

  test('German at /de/practice — same screen, translated chrome', async ({ page }) => {
    await page.goto('/de/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Übe einen B2-Aufsatz');
    await expect(page.getByRole('button', { name: 'Jetzt üben' })).toBeVisible();

    // Same structural guarantees as the English screen (KAN-8/27), not just
    // the same text swapped in — the step indicator is still there, in
    // German, with the same 5 steps.
    const progress = page.getByRole('list', { name: 'Fortschritt im Gast-Aufsatzablauf' });
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('listitem', { name: 'Schritt 1 von 5: Thema' })).toBeAttached();
  });

  test('the locale switcher actually changes the rendered language', async ({ page }) => {
    // The acceptance criterion this pins: switching locale changes what's
    // rendered, exercised as a real click + navigation, not a prop change.
    await page.goto('/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Practice a B2-style essay',
    );

    await page.getByRole('button', { name: 'DE', exact: true }).click();
    await expect(page).toHaveURL(/\/de\/practice$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Übe einen B2-Aufsatz');

    // And back again — this is routing, not a one-way trip.
    // exact: true — Playwright's accessible-name matching is a
    // case-insensitive substring match by default, and "Jetzt üben" (the
    // disabled CTA button, also on this screen) contains "en", so a loose
    // match for "EN" resolves to two elements.
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Practice a B2-style essay',
    );
  });

  test('German guest flow is noindex too, same as English (KAN-8)', async ({ page }) => {
    // The (guest) layout's noindex metadata now sits below [locale] — this is
    // the regression guard that moving it there didn't quietly scope it to
    // only the default locale.
    await page.goto('/de/practice');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('/de/practice is absent from the sitemap, same as /practice (scope: guest flow stays unindexed, in every locale)', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml');
    const body = await response.text();
    expect(body).not.toContain('/practice');
    expect(body).not.toContain('/de/practice');
  });

  test('zero console errors on the German screen', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      if (isCritical(err.message)) errors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isCritical(msg.text())) errors.push(msg.text());
    });

    await page.goto('/de/practice');
    await page.waitForLoadState('networkidle');

    expect(errors, `Console errors on /de/practice:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
