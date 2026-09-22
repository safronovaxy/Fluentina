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
import { fillTextboxAndWaitForWordCount } from './helpers/essay-fill';

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
  readonly tooShortError: string;
  readonly tooLongError: string;
  readonly lengthWarning: string;
  readonly recommendedRangeGuidance: string;
  /**
   * The exact `wordCount` ICU-plural string this locale's catalogue renders
   * for `n` words — see src/messages/{en,de}.json's own `wordCount` key.
   *
   * KAN-30 investigation: `n.toLocaleString(locale)`, not a bare `${n}` —
   * the catalogue's `#` placeholder (`"{count, plural, one {# word} other
   * {# words}}"`) is standard ICU MessageFormat, which formats `#` through
   * the locale's own `Intl.NumberFormat`, grouping included, not the raw
   * number. Below 1000 that's invisible (no separator either way), which is
   * why this fixture's own hand-written `${n}` version — never exercised at
   * n >= 1000 before this file started using `fillEssay` (below) for the
   * 1000-word case too — went uncaught: the real page renders "1,000 words"
   * / "1.000 Wörter", confirmed directly against a running instance, not
   * "1000 words" / "1000 Wörter".
   */
  readonly counterText: (n: number) => string;
}

const LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    writePath: '/practice/write',
    submitName: 'Submit essay',
    successTitle: 'Essay received',
    tooShortError: 'Your essay is too short to grade — write at least 50 words.',
    tooLongError: 'Your essay is too long — keep it to 300 words or fewer.',
    lengthWarning: "That's longer than the recommended range, but you can still submit it.",
    recommendedRangeGuidance: '150–200 words is the recommended length for a B2 essay.',
    counterText: (n) => `${n.toLocaleString('en')} ${n === 1 ? 'word' : 'words'}`,
  },
  {
    locale: 'de',
    writePath: '/de/practice/write',
    submitName: 'Aufsatz einreichen',
    successTitle: 'Aufsatz erhalten',
    tooShortError: 'Dein Aufsatz ist zu kurz zum Bewerten — schreibe mindestens 50 Wörter.',
    tooLongError: 'Dein Aufsatz ist zu lang — halte ihn auf 300 Wörter oder weniger.',
    lengthWarning: 'Das ist länger als der empfohlene Bereich, du kannst ihn aber trotzdem einreichen.',
    recommendedRangeGuidance: '150–200 Wörter sind die empfohlene Länge für einen B2-Aufsatz.',
    counterText: (n) => `${n.toLocaleString('de')} ${n === 1 ? 'Wort' : 'Wörter'}`,
  },
];

/**
 * KAN-30 investigation (Safari CI failure, both the 1000-word block and the
 * 150/201-word live-guidance case) found the fill()-then-act race and added
 * the after-fill counter wait; a later investigation, on the exact same
 * timeout, found a second and more severe race the first fix cannot catch
 * (the fill lost entirely, not merely delayed) and closed it with a
 * before-fill hydration guard. Both fixes now live in
 * `helpers/essay-fill.ts`'s `fillTextboxAndWaitForWordCount` (see that
 * file's own top comment for the full account of both races) once
 * essay-entry.spec.ts needed the identical guards rather than a second copy
 * of them. This wrapper stays file-local only for the `n`/`LocaleFixture`
 * convenience below.
 *
 * No precondition on `n` relative to a prior call any more (round-1 review:
 * this used to require `n` differ from the count already shown on the page,
 * which was silently false for exactly the one-word case — see
 * `fillTextboxAndWaitForWordCount`'s own comment for why that's now
 * guaranteed by construction instead).
 */
async function fillEssay(page: Page, fx: LocaleFixture, n: number): Promise<void> {
  await fillTextboxAndWaitForWordCount(page, wordsContent(n), fx.counterText(n));
}

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-15 — word-count guidance (${fx.locale})`, () => {
    // Round-3 review (Test Lead): the 1000-word fillEssay's 15_000ms counter
    // wait sits inside the suite's default 30s test timeout, alongside a
    // 10s actionTimeout and a 20s navigationTimeout (playwright.config.ts)
    // — worst case for that test is ~27s against a 30s cap. Detection was
    // never the problem (a real counter regression fails the first fill at
    // ~16s, well inside 30s); the problem was the OTHER direction: on a
    // badly contended runner, the flake this file exists to fix could
    // resurface as a bare "Test timeout of 30000ms exceeded", which points
    // at nothing, instead of the specific, actionable assertion failure on
    // the counter that 15_000ms is tuned to still catch. Raising the
    // per-test budget here — rather than trimming the 15_000ms wait itself
    // — is the fix: that value isn't arbitrary, it's the one the KAN-30
    // investigation found necessary under artificial CPU contention (see
    // fillEssay's own comment); cutting it back to buy margin would risk
    // reintroducing the exact flake this commit closes.
    //
    // Raised again, same reasoning, not a re-litigation of it: a hydration
    // race that could permanently lose a fill (see helpers/essay-fill.ts's
    // top comment) needed a real fix — a before-fill readiness guard, bounded
    // at 20s — not a bigger number on the existing wait; that guard adds up
    // to 20s ONCE per test (the first fill; every later fill in the same
    // test resolves it on the first attempt, at negligible cost, since
    // hydration only ever happens once). Worst case is now the 1000-word
    // test's single fillEssay call: up to 20s hydrating + up to 15s for the
    // counter itself, ~35s, plus nav/action/assertion overhead — comfortably
    // inside 90s, not 60s. This is test-INFRASTRUCTURE budget for a real,
    // bounded precondition, not the thing the story's "don't extend the
    // timeout as the fix" instruction rules out: that instruction is about
    // the counter wait itself, which is unchanged at 15_000ms.
    test.describe.configure({ timeout: 90_000 });

    test('a 220-word essay — the story\'s own "never blocked" verification case — submits successfully, with the non-blocking warning shown (not a block) along the way', async ({
      page,
    }, testInfo) => {
      skipIfWebkitCannotStoreTheSessionCookie(testInfo);
      await gotoOk(page, fx.writePath);

      await fillEssay(page, fx, 220);

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

      await fillEssay(page, fx, 1000);
      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(blockingMessage(page)).toHaveText(fx.tooLongError);
      // Never reached the success state — the click was blocked, not merely
      // slow; there is no pending/network state to wait out.
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));
    });

    // Round-1 review (should-fix #4): the too-short error was never
    // asserted against the REAL catalogue in either language — the locale
    // fixtures above carried tooLongError/lengthWarning/recommendedRangeGuidance,
    // but no tooShortError, and the unit suites (EssayEntryForm.test.tsx)
    // only ever assert against hand-written STRINGS props, never the actual
    // en.json/de.json this page reads from. That left the wiring on the
    // write page itself unproven: point `tooShortError` at the wrong
    // catalogue key and every other suite stays green while a guest under
    // 50 words is told the wrong thing, in both languages.
    test('blocks a 49-word essay client-side with the too-short message from the real catalogue, and never leaves the page', async ({ page }) => {
      await gotoOk(page, fx.writePath);

      await fillEssay(page, fx, 49);
      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(blockingMessage(page)).toHaveText(fx.tooShortError);
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${fx.writePath}$`));
    });

    // Round-1 review (should-fix #4, same finding): the counter's own text
    // is currently only ever asserted in jsdom (EssayEntryForm.test.tsx),
    // never against a real browser rendering next-intl's ICU plural rule
    // from the real catalogue — this is that proof, in the same run that
    // now also covers the too-short message above.
    test('shows the live word counter with the real catalogue text, singular and plural, in a real browser', async ({ page }) => {
      await gotoOk(page, fx.writePath);

      // This test's own assertion IS the `fillEssay` wait (the counter
      // text) — no separate wait-then-assert needed on top of it.
      await fillEssay(page, fx, 1);
      await fillEssay(page, fx, 42);
    });

    test('shows the recommended-range guidance at 150 words and the non-blocking warning at 201, live while typing, with no submit attempt at all', async ({ page }) => {
      await gotoOk(page, fx.writePath);

      await fillEssay(page, fx, 150);
      await expect(page.getByText(fx.recommendedRangeGuidance)).toBeVisible();
      await expect(page.getByText(fx.lengthWarning)).toHaveCount(0);

      await fillEssay(page, fx, 201);
      await expect(page.getByText(fx.lengthWarning)).toBeVisible();
      await expect(page.getByText(fx.recommendedRangeGuidance)).toHaveCount(0);

      // Neither is a block — no blocking message shown at either point.
      await expect(blockingMessage(page)).toHaveCount(0);
    });
  });
}
