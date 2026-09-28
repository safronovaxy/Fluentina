/**
 * KAN-18 (BR-4.1) — submit an essay, then see the overall band score and one
 * fully worked example from your own text, end to end.
 *
 * NOT RUN when this was written: no Playwright browser could be installed in
 * the authoring environment (cdn.playwright.dev is blocked), so CI's e2e job
 * is this file's first real execution. The component's behaviour (all five
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
  },
];

async function submitEssay(page: Page, fx: LocaleFixture) {
  const response = await page.goto(fx.writePath);
  expect(response?.ok(), `${fx.writePath} should respond 200`).toBe(true);
  await fillTextboxAndWaitForWordCount(page, fx.essayText, wordCountText(fx.locale, ESSAY_WORD_COUNT));
  await page.getByRole('button', { name: fx.submitName }).click();
  await expect(page).toHaveURL(new RegExp(`${fx.previewPath}\\?essay=[0-9a-f-]{36}$`));
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

      // No pending screen left behind.
      await expect(page.getByRole('region')).toHaveAttribute('data-phase', 'complete');
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
