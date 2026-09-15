/**
 * KAN-15 — live word-count guidance, end to end.
 *
 * The unit/integration suites (src/lib/contracts/word-count.test.ts,
 * src/lib/contracts/essay-submission.test.ts, src/app/api/essays/
 * route.test.ts, src/components/guest/EssayEntryForm.test.tsx) each pin the
 * full 49/50/51, 150, 200/201, 300/301 boundary matrix at their own layer.
 * This spec is the one place that proves the two cases the story names
 * explicitly hold in a real browser, against the real running app: a
 * 220-word guest is never blocked, and a 1000-word guest is blocked — see
 * essay-entry.spec.ts's own comment for why an e2e spec exists alongside
 * the lower-level suites at all.
 */
import { test, expect, type Page } from '@playwright/test';

const SESSION_COOKIE_NAME = '__Host-fluentina_guest_session';

// Same WebKit-over-plain-HTTP limitation essay-entry.spec.ts and
// guest-session.spec.ts already document and skip for — see either file's
// own comment. Only the tests below that actually submit (and so need the
// session cookie to have been stored) need the skip; the ones that only
// assert on-page guidance/warning text while typing do not.
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

/**
 * The essay-length blocking message, if any of the three (required/
 * too-short/too-long) is currently shown — scoped to `EssayEntryForm`'s own
 * `essay-content-*` ids, deliberately NOT a bare `page.getByRole('alert')`:
 * Next.js's App Router always renders a hidden `role="alert"`
 * `__next-route-announcer__` div for its own navigation announcements, so
 * an unscoped alert-role query never actually reaches zero on this page,
 * making a `toHaveCount(0)` assertion against it pass vacuously no matter
 * what EssayEntryForm renders.
 */
function blockingMessage(page: Page) {
  return page.locator('[id^="essay-content-"][role="alert"]');
}

/** `n` distinct, single-space-separated tokens — the same shape every other KAN-15 suite builds boundary content with. */
function wordsContent(n: number): string {
  return Array.from({ length: n }, (_, i) => `Wort${i}`).join(' ');
}

interface LocaleFixture {
  readonly locale: 'en' | 'de';
  readonly writePath: string;
  readonly submitName: string;
  readonly successTitle: string;
  readonly tooLongError: string;
  readonly lengthWarning: string;
  readonly recommendedRangeGuidance: string;
}

const LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    writePath: '/practice/write',
    submitName: 'Submit essay',
    successTitle: 'Essay received',
    tooLongError: 'Your essay is too long — keep it to 300 words or fewer.',
    lengthWarning: "That's longer than the recommended range, but you can still submit it.",
    recommendedRangeGuidance: '150–200 words is the recommended length for a B2 essay.',
  },
  {
    locale: 'de',
    writePath: '/de/practice/write',
    submitName: 'Aufsatz einreichen',
    successTitle: 'Aufsatz erhalten',
    tooLongError: 'Dein Aufsatz ist zu lang — halte ihn auf 300 Wörter oder weniger.',
    lengthWarning: 'Das ist länger als der empfohlene Bereich, du kannst ihn aber trotzdem einreichen.',
    recommendedRangeGuidance: '150–200 Wörter sind die empfohlene Länge für einen B2-Aufsatz.',
  },
];

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-15 — word-count guidance (${fx.locale})`, () => {
    test('a 220-word essay — the story\'s own "never blocked" verification case — submits successfully, with the non-blocking warning shown (not a block) along the way', async ({
      page,
    }, testInfo) => {
      skipIfWebkitCannotStoreTheSessionCookie(testInfo);
      await gotoOk(page, fx.writePath);

      await page.getByRole('textbox').fill(wordsContent(220));

      // Non-blocking: visible while still typing, no blocking message shown.
      await expect(page.getByText(fx.lengthWarning)).toBeVisible();
      await expect(blockingMessage(page)).toHaveCount(0);

      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(page.getByRole('status')).toHaveText(new RegExp(fx.successTitle));
    });

    test('a 1000-word essay — the story\'s own "blocked" verification case — is blocked client-side: the submit click never leaves the page, and the too-long message is shown', async ({
      page,
    }) => {
      await gotoOk(page, fx.writePath);

      await page.getByRole('textbox').fill(wordsContent(1000));
      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(blockingMessage(page)).toHaveText(fx.tooLongError);
      // Never reached the success state — the click was blocked, not merely
      // slow; there is no pending/network state to wait out.
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));
    });

    test('shows the recommended-range guidance at 150 words and the non-blocking warning at 201, live while typing, with no submit attempt at all', async ({ page }) => {
      await gotoOk(page, fx.writePath);
      const textarea = page.getByRole('textbox');

      await textarea.fill(wordsContent(150));
      await expect(page.getByText(fx.recommendedRangeGuidance)).toBeVisible();
      await expect(page.getByText(fx.lengthWarning)).toHaveCount(0);

      await textarea.fill(wordsContent(201));
      await expect(page.getByText(fx.lengthWarning)).toBeVisible();
      await expect(page.getByText(fx.recommendedRangeGuidance)).toHaveCount(0);

      // Neither is a block — no blocking message shown at either point.
      await expect(blockingMessage(page)).toHaveCount(0);
    });
  });
}
