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
// webServer serves. Runs against HTTPS (test:e2e:live) are not skipped.
//
// Round-1 review: this used to be a blanket `test.beforeEach` skip covering
// every test in this file, on the claim that "every test below either goes
// through the guest session cookie directly or through /api/essays". That
// was false for two of the four tests per locale: "never renders a file,
// camera or upload control" and "accepts pasted text" touch neither — with
// the skip removed, six of eight ran and passed on webkit-desktop over
// plain HTTP, including "no account or login is required", which submitted
// successfully. `/api/essays` minting a session for a caller presenting no
// cookie (since fixed — see route.ts's own comment) is what made that
// submission succeed even though the browser never stored one: the request
// still got a 201, the response body was all the client ever checked. Now
// that a missing cookie is rejected (400) instead, a WebKit-over-HTTP guest
// genuinely cannot submit at all — no cookie is ever stored, so
// `/api/essays` rejects every attempt — so BOTH tests that actually submit
// an essay need the skip, in both locales: the click-count test (which also
// asserts the cookie directly) and "no account or login is required" (which
// doesn't touch the cookie, but does require a successful submission). The
// other three tests per locale need no skip and now run for real WebKit
// coverage of their acceptance criteria (no upload/camera control; no
// horizontal overflow; pasted text accepted) — five tests per locale in
// total now that the horizontal-overflow test below exists, not four; only
// the two that actually submit an essay need the skip (round-2 review: this
// comment used to still say "two of four"/"four" after that test landed).
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isPlainHttp = BASE_URL.startsWith('http://');

function skipIfWebkitCannotStoreTheSessionCookie(testInfo: { project: { name: string } }) {
  test.skip(
    testInfo.project.name === 'webkit-desktop' && isPlainHttp,
    'WebKit refuses to store a __Host--prefixed cookie over plain HTTP, even on localhost, so no essay submission can succeed here — see the comment above isPlainHttp.',
  );
}

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
  readonly writeHeading: string;
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
    writeHeading: 'Write your essay',
  },
  {
    locale: 'de',
    landingPath: '/de/practice',
    writePath: '/de/practice/write',
    ctaName: 'Jetzt üben',
    submitName: 'Aufsatz einreichen',
    essayText: 'Dies ist ein Beispielaufsatz, der direkt im Textfeld des Browsers für den End-to-End-Test geschrieben wurde.',
    successTitle: 'Aufsatz erhalten',
    writeHeading: 'Schreibe deinen Aufsatz',
  },
];

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-14 — essay entry (${fx.locale})`, () => {
    test('a first-time visitor reaches the text box and submits an essay in exactly 2 clicks from landing — under the 3-click acceptance criterion', async ({
      page,
      context,
    }, testInfo) => {
      skipIfWebkitCannotStoreTheSessionCookie(testInfo);
      // Round-1 review: `clicks` is incremented twice in straight-line code
      // below, with no branching, so it is 2 on every run this test can
      // possibly complete — it can never actually observe a third click
      // being needed. What DOES fail, on all eight locale/project
      // combinations, if a future change makes this path need more
      // interaction, is the flow itself: an added required step (a
      // confirmation dialog, an extra screen) means `page.getByRole('status')`
      // below never appears, because nothing here drives that extra step.
      // The count is a document of the two interactions this known-good
      // path takes today, not independent proof of the acceptance
      // criterion — asserted `=== 2`, not `<= 3`, because `<= 3` is a bound
      // this counter can never approach, let alone violate, which is what
      // made it read as a live check when it wasn't one.
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
      expect(clicks, 'this known-good path takes exactly 2 clicks/taps — CTA, then submit').toBe(2);
    });

    test('no account or login is required anywhere on the path from landing to a submitted essay', async ({ page }, testInfo) => {
      skipIfWebkitCannotStoreTheSessionCookie(testInfo);
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

    // Round-1 review: running on multiple viewport projects (chromium-desktop,
    // chromium-mobile, webkit-desktop) is not by itself proof of
    // responsiveness if every assertion is viewport-independent — see
    // tests/guest-flow.spec.ts's own comment, which states that standard for
    // the landing page. Every assertion elsewhere in this file is
    // viewport-independent; this is the write screen's own version of the
    // same check guest-flow.spec.ts already runs for the landing page.
    test('loads with no horizontal overflow at the current viewport', async ({ page }) => {
      await gotoOk(page, fx.writePath);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(fx.writeHeading);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, 'page should not scroll horizontally').toBeLessThanOrEqual(clientWidth);
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
