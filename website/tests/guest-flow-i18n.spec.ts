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
import { test, expect, type Page } from '@playwright/test';

/**
 * BLOCKING regression this guards: `IntlProvider`/`request.ts` used to
 * rethrow *every* `IntlError`, including next-intl's own non-fatal
 * `ENVIRONMENT_FALLBACK` advisory, which fires on the first server-rendered
 * translation in any process with no configured `timeZone` — i.e. the
 * first guest request to a freshly started, scale-to-zero server process.
 * Playwright's own test server had already warmed up by the time these
 * specs ran, and React recovers a crashed server render client-side, so the
 * existing suite passed 12/12 against a server that returned a bare 500 to
 * `curl` on its first request — this whole class of bug was structurally
 * invisible to a browser-level assertion that only checks the rendered DOM.
 * `page.goto()`'s response is the wire-level status; asserting it directly,
 * for both locales, is what makes a regression here fail a test again
 * instead of quietly passing because React papered over the crash.
 */
async function gotoOk(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should respond 200, got ${response?.status()}`).toBe(true);
  return response;
}

test.describe('KAN-9 — guest flow renders in both locales', () => {
  test('English at /practice (no locale prefix — the default locale stays where it already was)', async ({
    page,
  }) => {
    await gotoOk(page, '/practice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Practice a B2-style essay',
    );
    await expect(page.getByRole('button', { name: /start practicing/i })).toBeVisible();
  });

  test('German at /de/practice — same screen, translated chrome', async ({ page }) => {
    await gotoOk(page, '/de/practice');
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

  test('the German screen\'s server-rendered subtree actually carries lang="de"', async ({
    page,
  }) => {
    // Unit-tested (GuestFlowShell renders `<div lang={locale}>`), but that
    // only proves the component's own logic — nothing at the unit level
    // proves the real server-rendered document agrees. Asserted on the
    // live DOM, not a snapshot, so a locale that resolves correctly for
    // *text* but not for this attribute (e.g. a hardcoded "en" default
    // slipping back in) would be caught here.
    await gotoOk(page, '/de/practice');
    await expect(page.locator('[lang="de"]')).toBeAttached();
  });

  test('the locale switcher actually changes the rendered language', async ({ page }) => {
    // The acceptance criterion this pins: switching locale changes what's
    // rendered, exercised as a real click + navigation, not a prop change.
    await gotoOk(page, '/practice');
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

  // Noindex-for-German and zero-console-errors-for-German are covered by
  // the parameterised describe block in tests/guest-flow.spec.ts (KAN-9:
  // that file now loops its whole KAN-8 suite over both locale fixtures),
  // rather than duplicated here as a second, hand-maintained copy of the
  // same two assertions.

  test('/en/practice (the prefixed default-locale path) redirects to /practice, not a second canonical URL', async ({
    request,
  }) => {
    // routing.ts's own claim, otherwise unasserted: "the two never both
    // serve as duplicate content." maxRedirects: 0 so Playwright doesn't
    // follow it and hide the actual status/target being asserted here.
    const response = await request.get('/en/practice', { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()['location']).toContain('/practice');
    expect(response.headers()['location']).not.toContain('/en/practice');
  });

  test('/de/practice is absent from the sitemap, same as /practice (scope: guest flow stays unindexed, in every locale)', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml');
    const body = await response.text();
    // Exact <loc> pathnames, not raw substring containment: "/practice" is
    // a substring of "/de/practice", so `body.not.toContain('/practice')`
    // passing made a second `not.toContain('/de/practice')` check
    // impossible to fail — of course a string that doesn't appear at all
    // doesn't appear with a "/de" prefix either. Comparing exact parsed
    // pathnames makes the two genuinely independent checks.
    const pathnames = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map(
      (m) => new URL(m[1]).pathname,
    );
    // Without this the two assertions below hold vacuously on an empty or
    // broken sitemap. That it is non-empty is guaranteed in sitemap.spec.ts,
    // but a test should not depend on a guarantee living in another file.
    expect(pathnames.length).toBeGreaterThan(0);
    expect(pathnames).not.toContain('/practice');
    expect(pathnames).not.toContain('/de/practice');
  });
});

test.describe('KAN-9 — a URL names its locale, the browser does not', () => {
  // routing.ts sets `localeDetection: false` (Irina, 2026-09-14), against
  // next-intl's default. The deciding factor was caching: once these pages
  // became genuinely prerendered, /practice started serving with a long
  // shared-cache lifetime while its body depended on a request header that
  // `Vary` does not name, so a shared cache could hand a stored English page
  // to a German visitor. With detection off, /practice is unambiguously
  // English and the cached copy is correct for everyone.
  //
  // This test is the guard on that: it fails if the default is ever restored,
  // which would reintroduce the hazard silently.
  test.use({ locale: 'de-DE' });

  test('a German-browser guest requesting /practice still gets English', async ({ page }) => {
    const response = await page.goto('/practice');
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page).not.toHaveURL(/\/de\/practice$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Practice a B2-style essay');
  });

});

test.describe('KAN-9 — the other direction: an English browser on the German URL', () => {
  // A separate block on purpose. The one above sets a German browser for all
  // its tests, so asserting there that /de/practice serves German would have
  // proved nothing about the URL winning over the header — the header agreed.
  test.use({ locale: 'en-US' });

  test('the German URL serves German to an English browser', async ({ page }) => {
    const response = await page.goto('/de/practice');
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Übe einen B2-Aufsatz');
    // The tab title comes from generateMetadata, which resolves the locale on
    // its own path — separate from the page body. A German page with an
    // English title would otherwise ship green.
    await expect(page).toHaveTitle(/B2-Aufsatz üben/);
  });
});
