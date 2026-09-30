/**
 * KAN-18 (BR-4.1) — submit an essay, then see the overall band score and one
 * fully worked example from your own text, end to end.
 *
 * NOT RUN when this was written: no Playwright browser could be installed in
 * the authoring environment (cdn.playwright.dev is blocked), so CI's e2e job
 * is this file's first real execution. (History, no longer true: the Chromium
 * projects can be run locally without installing anything — see "Running the
 * Playwright suite locally" in CONTRIBUTING.md.) The component's behaviour (all six
 * states, polling, focus, live region, the highlight/explanation
 * association) is covered by the unit suite — src/components/guest/
 * GradingPreview.test.tsx — which HAS been run; this spec proves only the
 * wiring: real browser, real POST /api/essays, the real inline grading queue
 * with MOCK_GRADING_PROVIDER=1 (ci.yml sets it), real Postgres, real polling
 * endpoint, real cookie ownership.
 *
 * Assertions are deliberately about the SHAPE of the result (a 0-100 score,
 * a band, a highlighted span that is really in the essay, an explanation),
 * not the fake provider's fixture values, so the same spec stays true if the
 * provider behind it changes.
 */
import { test, expect, type Page } from '@playwright/test';
import { fillTextboxAndWaitForWordCount, wordCountText } from './helpers/essay-fill';
import { isWebKitOverPlainHttp } from './helpers/webkit';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isPlainHttp = BASE_URL.startsWith('http://');

// Same WebKit limitation essay-entry.spec.ts documents: no __Host- cookie
// over plain HTTP, so no essay can be submitted at all.
function skipIfWebkitCannotStoreTheSessionCookie(browserName: string) {
  test.skip(
    isWebKitOverPlainHttp(browserName, isPlainHttp),
    'WebKit refuses to store a __Host--prefixed cookie over plain HTTP, so no essay submission can succeed here.',
  );
}

const ESSAY_WORD_COUNT = 60;
const FIRST_SENTENCE_EN = 'Yesterday I wrote a sentence for the end-to-end preview test.';
const FIRST_SENTENCE_DE = 'Gestern habe ich einen Satz für den End-to-End-Test der Vorschau geschrieben.';

function essayOf(firstSentence: string): string {
  const filler = Array.from({ length: ESSAY_WORD_COUNT - firstSentence.split(/\s+/).length }, (_, i) => `Wort${i}`).join(' ');
  return `${firstSentence} ${filler}.`;
}

interface LocaleFixture {
  readonly locale: 'en' | 'de';
  readonly writePath: string;
  readonly previewPath: string;
  readonly submitName: string;
  readonly essayText: string;
  readonly resultHeading: string;
  readonly announcementStart: string;
  readonly explanationLabel: string;
  /** The step indicator's accessible name for the current (Preview) step — no "completed" suffix. */
  readonly previewStepName: string;
  /** KAN-17: the pending screen's heading, and the strings a long-running job shows. */
  readonly pendingHeading: string;
  readonly slowNotice: string;
  readonly stageProcessing: string;
  readonly slowAnnouncement: string;
}

const LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    writePath: '/practice/write',
    previewPath: '/practice/preview',
    submitName: 'Submit essay',
    essayText: essayOf(FIRST_SENTENCE_EN),
    resultHeading: 'Your overall score',
    announcementStart: 'Grading finished. Your overall score is',
    explanationLabel: "What's wrong",
    previewStepName: 'Step 4 of 5: Preview',
    pendingHeading: 'Grading your essay',
    slowNotice: 'This is taking longer than the minute we aim for.',
    stageProcessing: 'Picked up for grading',
    slowAnnouncement: 'Still grading. This is taking longer than the minute we aim for.',
  },
  {
    locale: 'de',
    writePath: '/de/practice/write',
    previewPath: '/de/practice/preview',
    submitName: 'Aufsatz einreichen',
    essayText: essayOf(FIRST_SENTENCE_DE),
    resultHeading: 'Deine Gesamtpunktzahl',
    announcementStart: 'Bewertung abgeschlossen. Deine Gesamtpunktzahl:',
    explanationLabel: 'Was nicht stimmt',
    previewStepName: 'Schritt 4 von 5: Vorschau',
    pendingHeading: 'Dein Aufsatz wird bewertet',
    slowNotice: 'Das dauert länger als die eine Minute, die wir anstreben.',
    stageProcessing: 'Zur Bewertung übernommen',
    slowAnnouncement: 'Die Bewertung läuft noch. Das dauert länger als die eine Minute, die wir anstreben.',
  },
];

async function submitEssay(page: Page, fx: LocaleFixture) {
  const response = await page.goto(fx.writePath);
  expect(response?.ok(), `${fx.writePath} should respond 200`).toBe(true);
  await fillTextboxAndWaitForWordCount(page, fx.essayText, wordCountText(fx.locale, ESSAY_WORD_COUNT));
  await page.getByRole('button', { name: fx.submitName }).click();
  await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${fx.previewPath}\\?essay=[0-9a-f-]{36}$`));
}

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-18 — instant preview (${fx.locale})`, () => {
    // Submit + up to a few poll intervals, on a possibly slow shared runner.
    test.describe.configure({ timeout: 90_000 });

    test('after submitting, the guest sees their overall score, band and a worked example from their own essay', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      await submitEssay(page, fx);

      // Complete: the score is a real 0-100 number.
      const score = page.getByTestId('overall-score');
      await expect(score).toBeVisible({ timeout: 30_000 });
      const value = Number(await score.innerText());
      expect(Number.isInteger(value) && value >= 0 && value <= 100, `score ${value} should be 0-100`).toBe(true);
      await expect(page.getByTestId('overall-band')).not.toBeEmpty();

      // The worked example: the highlighted words really are in the guest's
      // own essay, inside a sentence of it, and an explanation is shown.
      const mark = page.getByTestId('worked-example-highlight');
      await expect(mark).toBeVisible();
      // The underline is the non-colour cue, and a class name in jsdom
      // proves nothing about what a guest sees: ask the engine. Runs in all
      // four projects (chromium-desktop, chromium-mobile, webkit-desktop,
      // webkit-mobile).
      const decoration = await mark.evaluate((el) => {
        const style = getComputedStyle(el);
        return { line: style.textDecorationLine, style: style.textDecorationStyle };
      });
      expect(decoration.line).toContain('underline');
      expect(decoration.style).toBe('wavy');
      const sentence = await page.getByTestId('worked-example-sentence').innerText();
      // Minus the screen-reader-only boundary markers, which are not essay text.
      const highlighted = await mark.evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.sr-only').forEach((node) => node.remove());
        return copy.textContent ?? '';
      });
      expect(highlighted.trim().length).toBeGreaterThan(0);
      expect(fx.essayText).toContain(highlighted.trim());
      expect(sentence.length).toBeGreaterThan(0);
      await expect(page.getByTestId('worked-example-explanation')).toContainText(fx.explanationLabel);

      // No pending screen left behind. Scoped by name, not a bare
      // `getByRole('region')`: every page also carries the two toast
      // regions Providers mounts (Radix's "Notifications (F8)" viewport and
      // Sonner's "Notifications alt+T" section), so an unnamed region locator
      // resolves to three elements and Playwright's strict mode throws. The
      // panel is labelled by its heading (aria-labelledby), which after a
      // result is the result heading — so this also proves that labelling.
      await expect(page.getByRole('region', { name: fx.resultHeading })).toHaveAttribute('data-phase', 'complete');

      // The step indicator is on the Preview step — not still on Write.
      await expect(page.getByRole('listitem', { name: fx.previewStepName })).toHaveAttribute('aria-current', 'step');
    });

    // KAN-19 (BR-4.2). NOT RUN when written, like the rest of this file: CI's
    // e2e job is its first real execution. The unit and route tests prove what
    // the server sends; this proves it end to end, in a real browser, from
    // the poll the page itself makes — the lock is what arrives, not what the
    // page chooses to draw. Assertions are about SHAPE (which keys exist), not
    // the fake provider's values.
    test('the guest\'s own poll answer is a locked report — nothing withheld is sent, and the page says so', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const answers: Array<{ status?: string; report?: { access?: string } } | null> = [];
      page.on('response', async (response) => {
        if (/^\/api\/essays\/[^/]+\/grading$/.test(new URL(response.url()).pathname)) {
          answers.push(await response.json().catch(() => null));
        }
      });
      await submitEssay(page, fx);
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('locked-report')).toBeVisible();

      await expect.poll(() => answers.some((a) => a?.status === 'succeeded')).toBe(true);
      const succeeded = answers.find((a) => a?.status === 'succeeded');
      expect(succeeded?.report?.access).toBe('locked');
      expect(JSON.stringify(succeeded)).not.toMatch(/"summary"|"dimensions"|"annotations"|"start"|"end"|"comment"|"result"/);
    });

    test('the explanation is programmatically tied to the highlighted words, and completion is announced', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      await submitEssay(page, fx);
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });

      const explanationId = await page.getByTestId('worked-example-explanation').getAttribute('id');
      expect(explanationId).toBeTruthy();
      await expect(page.getByTestId('worked-example-highlight')).toHaveAttribute('aria-describedby', explanationId!);
      await expect(page.getByTestId('worked-example-highlight')).toHaveAttribute('aria-details', explanationId!);

      await expect(page.getByRole('status')).toContainText(fx.announcementStart);
    });

    test('keyboard focus is on the result heading, not lost, once the result has replaced the waiting state', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      await submitEssay(page, fx);

      await expect(page.getByRole('heading', { name: fx.resultHeading })).toBeFocused({ timeout: 30_000 });
    });

    test('reloading the preview shows the same result — it lives at a URL, not in browser state', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      await submitEssay(page, fx);
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });
      const before = await page.getByTestId('overall-score').innerText();

      await page.reload();

      await expect(page.getByTestId('overall-score')).toHaveText(before, { timeout: 30_000 });
      await expect(page.getByTestId('worked-example-highlight')).toBeVisible();
    });

    // KAN-17. The mock provider finishes in milliseconds, so a genuinely slow
    // job cannot be produced through the real pipeline here. Only the POLL is
    // answered by the test (a job past the minute, `processing`); the submit,
    // the navigation, the server-rendered page and its catalogue strings are
    // all real, which is the wiring the unit suite cannot see. Nothing here
    // proves a job can be slow — it proves the page, given a poll that says
    // so, shows and announces it. Once the slow state has been observed the
    // stub is removed and the real (finished) job's result must replace it.
    //
    // The reported age is computed PER POLL, never fixed once: a `createdAt`
    // pinned at 70s old would age in wall-clock time toward
    // GRADING_POLL_MAX_AGE_MS (120s), where the page stops polling for good
    // and the phase flips to `stalled` — and a slow CI run would race it. It
    // starts at 65s and grows with real time (so the clock visibly advances,
    // as a real job's would) but stops growing 40s later, at 105s: it can
    // never reach the bound, however long the run takes. (A constant age
    // would not do either: every poll would reset the client's extrapolation,
    // and the monotonic clock would freeze within a poll or two.)
    test('a poll reporting a job past the minute shows real progress, is announced once, and gives way to the result', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      let firstPollAt: number | undefined;
      await page.route('**/api/essays/*/grading', (route) => {
        firstPollAt ??= Date.now();
        const ageMs = 65_000 + Math.min(Date.now() - firstPollAt, 40_000);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { date: new Date().toUTCString() },
          body: JSON.stringify({
            status: 'processing',
            report: null,
            failureReason: null,
            createdAt: new Date(Date.now() - ageMs).toISOString(),
          }),
        });
      });
      await submitEssay(page, fx);

      const notice = page.getByTestId('slow-notice');
      await expect(notice).toContainText(fx.slowNotice, { timeout: 30_000 });
      await expect(page.getByTestId('grading-stage')).toHaveText(fx.stageProcessing);
      await expect(page.getByTestId('grading-elapsed')).toContainText(/^1:\d\d$/);
      // Still the waiting screen, on the same focused heading, with one announcer.
      await expect(page.getByRole('region', { name: fx.pendingHeading })).toHaveAttribute('data-phase', 'pending');
      await expect(page.getByRole('heading', { name: fx.pendingHeading })).toBeFocused();
      await expect(page.getByRole('status')).toHaveText(fx.slowAnnouncement);
      // The clock moves between polls...
      const before = await page.getByTestId('grading-elapsed').innerText();
      await expect(page.getByTestId('grading-elapsed')).not.toHaveText(before, { timeout: 5_000 });
      // ...and none of that re-announces.
      await expect(page.getByRole('status')).toHaveText(fx.slowAnnouncement);

      await page.unroute('**/api/essays/*/grading');
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('slow-notice')).toHaveCount(0);
    });

    test('another guest cannot open this essay\'s preview — same 404 as an essay that does not exist', async ({ page, browser, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      await submitEssay(page, fx);
      const previewUrl = new URL(page.url());

      const other = await browser.newContext();
      try {
        const otherPage = await other.newPage();
        // A first visit gives this context its own, different guest session.
        await otherPage.goto(fx.writePath);
        const stranger = await otherPage.goto(previewUrl.pathname + previewUrl.search);
        expect(stranger?.status()).toBe(404);
        await expect(otherPage.getByTestId('overall-score')).toHaveCount(0);

        const missing = await otherPage.goto(`${fx.previewPath}?essay=00000000-0000-4000-8000-000000000000`);
        expect(missing?.status()).toBe(404);
      } finally {
        await other.close();
      }
    });
  });
}
