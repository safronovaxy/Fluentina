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
 * 150/201-word live-guidance case): fills the textarea and then waits for
 * the live word counter — `EssayEntryForm`'s own re-render off `content`
 * state, the one thing on this page that can only show the right number
 * once React has actually processed the fill — to reflect `n`, before the
 * caller does anything else (assert other derived text, or click submit).
 *
 * This is not a workaround for a flaky test; it closes a genuine gap in
 * what the test proved. `page.getByRole('textbox').fill(...)` resolving
 * only means Playwright's WebKit driver finished ITS side of setting the
 * value; it is not a guarantee that the `input` event has been dispatched
 * and handled, that React's `onChange` has run, or that the component has
 * re-rendered — those all still have to happen on the page's own event
 * loop, and this spec used to click submit or assert some OTHER derived
 * bit of UI immediately after `fill()` returned, trusting that gap was
 * always zero. Under real CI load (a shared, CPU-constrained runner, not
 * this machine) it measurably was not: reproduced locally by generating
 * artificial CPU contention and repeating the affected tests, `fill()`
 * followed immediately by `click()` intermittently reached the submit
 * handler while `content` was still `''` from the PREVIOUS render — the
 * guest was told the box was empty (`essay-content-error`, the exact text
 * and locator the pipeline reported), not that the essay was too long or
 * too short. `fill()` immediately followed by an assertion on a DIFFERENT
 * derived string (the 150-word guidance text, the 220-word warning text)
 * raced the same way, with no submit involved at all — confirming this is
 * a propagation race between the test and the app, not a defect specific
 * to the submit path, and not something a real guest can trigger: a real
 * paste's `input` event and a real click are two separate, later browser
 * events on the SAME single JS thread — the click cannot even begin
 * processing until the paste's synchronous `onChange` handler (a plain
 * `setContent`, nothing async) has already finished, so `content` is
 * always current by the time a real click fires. Playwright's WebKit
 * driver is a separate, out-of-process automation client issuing `fill`
 * and `click` as two independent commands, which is exactly what let them
 * observably reorder under load where two real browser events on one
 * thread cannot.
 *
 * Waiting on the counter specifically (rather than, say, extending
 * `expect`'s timeout globally, or trusting whichever assertion happened to
 * come next in a given test) is the fix the story asked for: an
 * observable signal that the fill actually landed, asserted before the
 * test acts on it — the same computed `wordCount` every other assertion in
 * this file already depends on, so nothing downstream can be "ahead" of
 * it.
 *
 * `timeout: 15_000`, not the suite's 5s default (precedented elsewhere —
 * see tests/blog.spec.ts's own 8s/20s overrides for the same reason): a
 * 1000-word fill is a bigger DOM write and a bigger controlled-input
 * re-render than the 1/42/49/150/201/220-word ones this same helper also
 * covers, and it was the one that timed out first under artificial CI-like
 * CPU contention in the KAN-30 investigation, even once the assertion was
 * moved to the correct signal (see the earlier comment on this function).
 * Generous, not indefinite: still fails, just past the point where normal
 * scheduling jitter would have resolved it, rather than past the point a
 * real defect would.
 */
async function fillEssay(page: Page, fx: LocaleFixture, n: number): Promise<void> {
  await page.getByRole('textbox').fill(wordsContent(n));
  await expect(page.getByText(fx.counterText(n), { exact: true })).toBeVisible({ timeout: 15_000 });
}

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-15 — word-count guidance (${fx.locale})`, () => {
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
