/**
 * Shared essay-textarea fill helpers.
 *
 * KAN-30 found (and KAN-15's word-count spec first fixed) a real race: this
 * page's word counter, guidance and warning text all re-render off React
 * `content` state, and `page.getByRole('textbox').fill(...)` resolving only
 * means the browser driver finished setting the DOM value — not that the
 * `input` event has been dispatched and handled, that `onChange` has run, or
 * that the component has re-rendered. Under real CI load (a shared,
 * CPU-constrained runner) `fill()` immediately followed by `click()` or by an
 * assertion on some OTHER derived bit of UI intermittently ran ahead of that
 * re-render — reproduced by generating artificial CPU contention and
 * repeating the affected tests. A real guest cannot trigger this: a real
 * paste's `input` event and a real click are two separate, later events on
 * the SAME single JS thread, so the click cannot even begin processing until
 * the paste's synchronous `onChange` handler has already finished. Playwright
 * is a separate, out-of-process automation client issuing `fill` and `click`
 * as two independent commands, which is exactly what let them observably
 * reorder under load where two real browser events on one thread cannot.
 *
 * `fillTextboxAndWaitForWordCount` closes that gap: it waits on the live
 * word counter — the one thing on this page that can only show the right
 * number once React has actually processed the fill — before the caller acts
 * on it, rather than trusting the gap between `fill()` resolving and the next
 * assertion or click is always zero.
 *
 * Originally lived only in tests/word-count.spec.ts, one file's private
 * helper. KAN-33 (adding a second WebKit project) needed to touch
 * tests/essay-entry.spec.ts anyway (see helpers/webkit.ts for the other thing
 * that touch found), and that spec has the exact same unguarded
 * `fill()`-then-`click()` pattern on its two submitting tests — the race this
 * file exists to close, on the same page, just not yet reproduced there.
 * Lifting the helper here instead of duplicating a second copy of it is
 * KAN-35's job; doing it as part of KAN-33 rather than opening a third round
 * trip since the touch was already required.
 */
import { type Page, expect } from '@playwright/test';

/**
 * The exact `wordCount` ICU-plural string next-intl renders for `n` words in
 * `locale` — see src/messages/{en,de}.json's own `wordCount` key
 * (`"{count, plural, one {# word} other {# words}}"`, and the German
 * `"Wort"`/`"Wörter"` equivalent).
 *
 * `n.toLocaleString(locale)`, not a bare `${n}` — the catalogue's `#`
 * placeholder formats through the locale's own `Intl.NumberFormat`, grouping
 * included. Below 1000 that's invisible (no separator either way), which is
 * why an unqualified `${n}` version of this went uncaught until a 1000-word
 * case existed: the real page renders "1,000 words" / "1.000 Wörter"
 * (KAN-30 investigation, confirmed directly against a running instance), not
 * "1000 words" / "1000 Wörter".
 */
export function wordCountText(locale: 'en' | 'de', n: number): string {
  const unit = locale === 'de' ? (n === 1 ? 'Wort' : 'Wörter') : n === 1 ? 'word' : 'words';
  return `${n.toLocaleString(locale)} ${unit}`;
}

/**
 * Fills the essay textarea and waits for the live word counter to reflect
 * `expectedCounterText` before returning — see this file's own top comment
 * for why that specific signal, not the fill's own resolution, is what makes
 * it safe for a caller to act next.
 *
 * `timeout: 15_000`, not the suite's 5s default (precedented elsewhere — see
 * tests/blog.spec.ts's own 8s/20s overrides for the same reason): a
 * thousand-word fill is a bigger DOM write and a bigger controlled-input
 * re-render than a handful of words, and it was the one that timed out first
 * under artificial CI-like CPU contention in the KAN-30 investigation, even
 * once the assertion was moved to the correct signal. Generous, not
 * indefinite: still fails, just past the point where normal scheduling
 * jitter would have resolved it, rather than past the point a real defect
 * would.
 *
 * Precondition: `expectedCounterText` must differ from the count already
 * shown on the page (fresh page: any non-zero count; after a prior call in
 * the same test: any count other than that call's). The wait below only
 * proves anything because the target text is not already on the page when it
 * starts — call this twice with the same count, or with a zero count on a
 * page that has never been filled, and `toBeVisible` is satisfied by the
 * STALE text instantly, silently reverting to the unguarded fill-then-act
 * this function exists to close.
 */
export async function fillTextboxAndWaitForWordCount(
  page: Page,
  content: string,
  expectedCounterText: string,
  timeout = 15_000,
): Promise<void> {
  await page.getByRole('textbox').fill(content);
  await expect(page.getByText(expectedCounterText, { exact: true })).toBeVisible({ timeout });
}
