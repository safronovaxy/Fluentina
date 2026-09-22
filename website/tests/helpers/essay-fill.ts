/**
 * Shared essay-textarea fill helpers.
 *
 * KAN-30 found (and KAN-15's word-count spec first fixed) a real race: this
 * page's word counter, guidance and warning text all re-render off React
 * `content` state, and `page.getByRole('textbox').fill(...)` resolving only
 * means the browser driver finished setting the DOM value -- not that the
 * `input` event has been dispatched and handled, that `onChange` has run, or
 * that the component has re-rendered. KAN-30's fix -- still here, in
 * `fillTextboxAndWaitForWordCount` below -- was to wait for the counter to
 * reflect the fill AFTER it, before the caller acts on it.
 *
 * This file's second fix (`ensureEssayFormHydrated`, below) closes a
 * DIFFERENT, more severe race that wait-after-the-fact fix cannot explain
 * or catch: a pipeline run reported one hard failure and five flaky runs,
 * every one on WebKit, every one timing out at exactly that after-fill
 * counter wait -- meaning the fill was never observed AT ALL, not merely
 * delayed. A wait that times out on its own effect can't be fixed by
 * waiting longer; it was already failing at 15 seconds, and nothing further
 * out would have helped either (see below).
 *
 * Reproduced directly, not guessed: navigate to the write page and fill the
 * textarea immediately -- the exact shape every call site here already
 * used -- under artificial CPU contention standing in for a slow, shared
 * runner. WebKit has no CDP CPU-throttling API (that's Chromium-only), so
 * this used OS-level contention (competing busy-loop processes) rather than
 * `Emulation.setCPUThrottlingRate`. Instrumented both sides directly: the
 * textarea's own DOM `.value` (what the driver actually wrote) against the
 * live counter text (the one thing that can only be right once React has
 * actually processed the fill). Result: the DOM value held the typed
 * content while the counter stayed at its PRE-fill count -- confirmed
 * permanent, not slow, by waiting a further 30 seconds past the real 15s
 * timeout with no further action taken; it never recovered.
 *
 * Root cause: this page is server-rendered, so the textarea exists,
 * enabled and fillable, in the markup the browser paints before a single
 * byte of the client bundle has run. A `fill()` issued in that window sets
 * the DOM value happily -- nothing stops it -- but no `onChange` listener
 * is attached yet, so the resulting `input` event has nothing to reach.
 * React then hydrates with ITS OWN initial state (`content = ''`), which is
 * unrelated to whatever the DOM's `.value` already says by then, and
 * nothing ever reconciles the two afterwards: hydration is a one-time
 * commit, not an ongoing subscription, and no further browser event fires
 * on its own to carry the already-lost input forward. That's why no
 * duration of waiting AFTER the fill could ever have caught this: the
 * effect being waited for depends on an event that already happened with
 * nothing listening, not one that is merely running late.
 *
 * Fix: don't fill for real until something has PROVED a handler is
 * attached. Waiting for the counter to merely be PRESENT proves nothing --
 * it's in the server-rendered markup too, before hydration, same as the
 * textarea itself. `ensureEssayFormHydrated` below proves it by making the
 * counter actually REACT to an input, with a disposable probe fill --
 * retried, not just waited on: a single probe that itself lands in the
 * pre-hydration window is exactly as lost as any other fill would be, so
 * retrying the ACTION (a fresh probe fill, not a re-check of the same
 * stale consequence) is what a passive wait after one fill can never give
 * you. `fillTextboxAndWaitForWordCount` runs this before every real fill,
 * so every existing call site is covered without having to remember to call
 * it -- and KAN-30's own after-fill wait stays exactly as it was on top of
 * it: that fix was correct, it just was never sufficient on its own to
 * prove the FIRST fill on a fresh page landed at all.
 *
 * Originally lived only in tests/word-count.spec.ts, one file's private
 * helper. Lifted here once essay-entry.spec.ts needed the identical
 * fill()-then-act race guard on its own two submitting tests, on the same
 * page, rather than duplicating a second copy of it.
 */
import { type Page, expect } from '@playwright/test';

/**
 * The exact `wordCount` ICU-plural string next-intl renders for `n` words in
 * `locale` -- see src/messages/{en,de}.json's own `wordCount` key
 * (`"{count, plural, one {# word} other {# words}}"`, and the German
 * `"Wort"`/`"Wörter"` equivalent).
 *
 * `n.toLocaleString(locale)`, not a bare `${n}` -- the catalogue's `#`
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
 * The live word-count element, located STRUCTURALLY (the essay textarea's
 * own next sibling in `EssayEntryForm.tsx`) rather than by its text.
 * `fillTextboxAndWaitForWordCount`'s own post-fill wait, and every other
 * locator in the specs that call it, deliberately prefer role/id/exact-text
 * over structure (see word-count.spec.ts's own `blockingMessage()` for the
 * standing reason this file follows that convention too) -- this is the one
 * needed exception, because `ensureEssayFormHydrated` below has to detect
 * that this text CHANGED before it can know, in whatever locale the page
 * happens to be in, what it changed TO. `#essay-content` is the textarea's
 * own real id (already referenced by `EssayEntryForm.tsx`'s
 * `essay-content-*` error ids), not an incidental class name, so this stays
 * anchored to something the component's own markup already treats as
 * stable.
 */
function liveWordCountLocator(page: Page) {
  return page.locator('#essay-content + div');
}

/**
 * Proves the write page is genuinely interactive -- React has hydrated and
 * attached its `onChange` handler -- before any real content is filled.
 * See this file's own top comment for the race this closes and why a mere
 * wait on the counter's presence (it's server-rendered too) cannot.
 *
 * The probe's word count is always the textarea's CURRENT raw DOM word count
 * plus one -- read directly off `inputValue()`, which works whether or not
 * React has hydrated, since it's just the DOM property, not the component's
 * state -- rather than a fixed or merely-incrementing probe string. That
 * guarantees, by construction rather than by luck, that a correctly
 * processed probe changes the rendered COUNT, not just its text: a fixed
 * one-word probe (`"x"`, or any single token) would render IDENTICALLY to
 * whatever the counter already shows whenever a prior real fill in the same
 * test also happened to be one word (`fillEssay(page, fx, 1)`, which this
 * suite's own "singular and plural" test does) -- caught by exactly that
 * test on webkit-desktop while developing this fix: `ensureEssayFormHydrated`
 * spun for the full 20s reporting "the counter never reacted", when what had
 * actually happened was hydration succeeding instantly and the counter
 * correctly continuing to show "1 word" for a DIFFERENT reason (the probe
 * also being exactly one word). Deriving the probe count from whatever is
 * already there removes that ambiguity structurally instead of relying on
 * the probe text happening not to collide.
 *
 * `timeout: 20_000` on the retry loop as a whole: generous enough to cover
 * a genuinely slow (not lost) hydration under real contention -- the same
 * kind of load that produced this race in the first place -- without being
 * indefinite. Once this resolves, hydration is a one-time event: it never
 * needs re-proving for the rest of the test, and on an already-hydrated
 * page (every call after the first in a test with more than one fill) it
 * resolves on the very first attempt, at negligible cost.
 */
async function ensureEssayFormHydrated(page: Page): Promise<void> {
  const textbox = page.getByRole('textbox');
  const counter = liveWordCountLocator(page);
  await expect(async () => {
    const currentValue = await textbox.inputValue();
    const currentWordCount = currentValue.trim() === '' ? 0 : currentValue.trim().split(/\s+/).length;
    const probeContent = Array.from({ length: currentWordCount + 1 }, (_, i) => `probe${i}`).join(' ');
    const before = await counter.textContent();
    await textbox.fill(probeContent);
    const after = await counter.textContent();
    expect(after, 'the live word counter never reacted to a probe fill -- the page is not hydrated yet').not.toBe(
      before,
    );
  }).toPass({ timeout: 20_000 });
}

/**
 * Fills the essay textarea and waits for the live word counter to reflect
 * `expectedCounterText` before returning. Two guards, not one:
 *
 *  1. `ensureEssayFormHydrated` (above) -- proves the page can react to an
 *     input at all, BEFORE the real fill, closing the total-loss race this
 *     file's top comment documents.
 *  2. The wait below, AFTER the real fill -- KAN-30's original fix, for the
 *     ordinary propagation delay between a landed `input` event and the
 *     component's own re-render. Still needed even once (1) has run: (1)
 *     only proves a handler is attached, not that THIS specific fill's
 *     event has already been processed by the time `fill()` returns.
 *
 * `timeout: 15_000`, not the suite's 5s default (precedented elsewhere --
 * see tests/blog.spec.ts's own 8s/20s overrides for the same reason): a
 * thousand-word fill is a bigger DOM write and a bigger controlled-input
 * re-render than a handful of words, and it was the one that timed out
 * first under artificial CI-like CPU contention in the KAN-30 investigation,
 * even once the assertion was moved to the correct signal. Generous, not
 * indefinite: still fails, just past the point where normal scheduling
 * jitter would have resolved it, rather than past the point a real defect
 * would.
 *
 * Precondition (unchanged from KAN-30): `expectedCounterText` must differ
 * from the count already shown on the page (fresh page: any non-zero count;
 * after a prior call in the same test: any count other than that call's).
 * The wait below only proves anything because the target text is not
 * already on the page when it starts -- call this twice with the same
 * count, or with a zero count on a page that has never been filled, and
 * `toBeVisible` is satisfied by the STALE text instantly, silently
 * reverting to the unguarded fill-then-act this function exists to close.
 */
export async function fillTextboxAndWaitForWordCount(
  page: Page,
  content: string,
  expectedCounterText: string,
  timeout = 15_000,
): Promise<void> {
  await ensureEssayFormHydrated(page);
  await page.getByRole('textbox').fill(content);
  await expect(page.getByText(expectedCounterText, { exact: true })).toBeVisible({ timeout });
}
