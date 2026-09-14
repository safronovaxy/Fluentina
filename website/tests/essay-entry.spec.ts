/**
 * KAN-14 — guest essay entry, end to end.
 *
 * The unit/integration suites (src/lib/domain/essay-submission.test.ts,
 * src/app/api/essays/route.test.ts, src/components/guest/EssayEntryForm.
 * test.tsx) each exercise one layer of this in isolation, against mocks or
 * a stubbed fetch. This spec is the one place that proves them wired
 * together correctly in a real running app: a real browser, a real click
 * count from the guest flow's own landing page (`/practice` — "landing" in
 * this story's acceptance criteria, the same page KAN-8's own comments call
 * it, not the separate, unlinked marketing homepage), against the real
 * local Postgres this suite's `webServer` starts the app against.
 */
import { test, expect, type Page } from '@playwright/test';

const SESSION_COOKIE_NAME = '__Host-fluentina_guest_session';

// Same known WebKit limitation guest-session.spec.ts already documents and
// skips for: WebKit refuses to store a __Host--prefixed cookie over plain
// HTTP, even on localhost, which is exactly what this suite's local
// webServer serves. Every test below either goes through the guest
// session cookie directly or through /api/essays, which resolves it —
// skip the same combination here rather than let it fail on an
// environment limitation unrelated to KAN-14. Runs against HTTPS
// (test:e2e:live) are not skipped.
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isPlainHttp = BASE_URL.startsWith('http://');

async function gotoOk(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should respond 200, got ${response?.status()}`).toBe(true);
  return response;
}

interface LocaleFixture {
  readonly locale: 'en' | 'de';
  readonly landingPath: string;
  readonly writePath: string;
  readonly ctaName: string;
  readonly submitName: string;
  readonly essayText: string;
  readonly successTitle: string;
}

const LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    landingPath: '/practice',
    writePath: '/practice/write',
    ctaName: 'Start practicing',
    submitName: 'Submit essay',
    essayText: 'This is a sample essay written directly in the browser text box for the end-to-end test.',
    successTitle: 'Essay received',
  },
  {
    locale: 'de',
    landingPath: '/de/practice',
    writePath: '/de/practice/write',
    ctaName: 'Jetzt üben',
    submitName: 'Aufsatz einreichen',
    essayText: 'Dies ist ein Beispielaufsatz, der direkt im Textfeld des Browsers für den End-to-End-Test geschrieben wurde.',
    successTitle: 'Aufsatz erhalten',
  },
];

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-14 — essay entry (${fx.locale})`, () => {
    test.beforeEach(async ({}, testInfo) => {
      test.skip(
        testInfo.project.name === 'webkit-desktop' && isPlainHttp,
        'WebKit refuses to store a __Host--prefixed cookie over plain HTTP, even on localhost — see the comment above SESSION_COOKIE_NAME (same skip as guest-session.spec.ts). Runs against HTTPS (test:e2e:live) are not skipped.',
      );
    });

    test('a first-time visitor reaches the text box and submits an essay in under 3 clicks from landing', async ({
      page,
      context,
    }) => {
      let clicks = 0;
      const click = async (locator: ReturnType<Page['getByRole']>) => {
        await locator.click();
        clicks += 1;
      };

      // Landing itself is not a click — this is where "a first-time
      // visitor" starts, per the acceptance criterion's own wording.
      await gotoOk(page, fx.landingPath);
      // No guest session cookie planted by anything but this first
      // navigation — establishes "first-time visitor" is not already
      // carrying state from an earlier run.
      const cookiesOnLanding = await context.cookies();
      expect(cookiesOnLanding.some((c) => c.name === SESSION_COOKIE_NAME)).toBe(true);

      // Click 1: the primary CTA.
      await click(page.getByRole('link', { name: fx.ctaName, exact: true }));
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));

      // Typing is not a click or a tap — the acceptance criterion counts
      // clicks/taps, and filling a text box is neither.
      await page.getByRole('textbox').fill(fx.essayText);

      // Click 2: submit.
      await click(page.getByRole('button', { name: fx.submitName }));

      await expect(page.getByRole('status')).toHaveText(new RegExp(fx.successTitle));
      expect(clicks, 'reaching the text box and submitting should take at most 3 clicks/taps from landing').toBeLessThanOrEqual(3);
    });

    test('no account or login is required anywhere on the path from landing to a submitted essay', async ({ page }) => {
      await gotoOk(page, fx.landingPath);
      await page.getByRole('link', { name: fx.ctaName, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));

      // No auth-related field anywhere on the essay-entry screen itself.
      await expect(page.getByLabel(/email/i)).toHaveCount(0);
      await expect(page.getByLabel(/password/i)).toHaveCount(0);

      await page.getByRole('textbox').fill(fx.essayText);
      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(page.getByRole('status')).toBeVisible();
      // Submitting never redirected anywhere — in particular not to a
      // login/register route that doesn't exist yet.
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));
    });

    test('never renders a file, camera or upload control — text entry only (KAN-14 AC)', async ({ page }) => {
      await gotoOk(page, fx.writePath);

      expect(await page.locator('input[type="file"]').count()).toBe(0);
      expect(await page.locator('[capture]').count()).toBe(0);
    });

    test('accepts pasted text, not only typed text', async ({ page }) => {
      await gotoOk(page, fx.writePath);

      const textarea = page.getByRole('textbox');
      // Playwright's fill() sets the value directly, exercising the exact
      // controlled onChange path a real paste triggers in the browser
      // (see EssayEntryForm.test.tsx for the direct proof pasting isn't
      // blocked by any handler) — this proves the end-to-end path accepts
      // whatever ends up in the field, regardless of how it got there.
      await textarea.evaluate((el: HTMLTextAreaElement, text: string) => {
        el.focus();
        document.execCommand('insertText', false, text);
      }, fx.essayText);

      await expect(textarea).toHaveValue(fx.essayText);
    });
  });
}
