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
 * Round-1 review of this fix (blocking): the probe used to be sized off the
 * page's CURRENT word count alone (current + 1), which guarantees it differs
 * from whatever was on the page before -- but says nothing about whether it
 * differs from the count the caller is about to fill for real. On a fresh
 * page current is 0, so the probe was always exactly one word, and any test
 * that fills exactly one word first (this suite's own "singular and plural"
 * case) got its "1 word" wait satisfied by the probe's own leftover text,
 * never observing the real fill at all -- silently reverting to the
 * unguarded fill-then-act this function exists to close, for the one-word
 * case specifically. `ensureEssayFormHydrated` now takes the content the
 * caller is about to fill and sizes the probe to differ from BOTH the
 * current count and that upcoming one -- see its own comment below.
 *
 * Originally lived only in tests/word-count.spec.ts, one file's private
 * helper. Lifted here once essay-entry.spec.ts needed the identical
 * fill()-then-act race guard on its own two submitting tests, on the same
 * page, rather than duplicating a second copy of it -- both now call
 * `fillTextboxAndWaitForWordCount` below instead of filling the textbox
 * directly.
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

/** Whitespace-real word count -- the same splitting rule the probe and the callers' own fixtures use. */
function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The live word-count element, located by its own `data-testid`
 * (`EssayEntryForm.tsx`'s `essay-word-count`) rather than by its text or its
 * structural position. `fillTextboxAndWaitForWordCount`'s own post-fill
 * wait, and every other locator in the specs that call it, deliberately
 * prefer role/id/exact-text over structure (see word-count.spec.ts's own
 * `blockingMessage()` for the standing reason this file follows that
 * convention too) -- `ensureEssayFormHydrated` below can't use text either,
 * since it has to detect that this text CHANGED before it can know, in
 * whatever locale the page happens to be in, what it changed TO.
 *
 * Round-3 review (should-fix): this used to be `#essay-content + div`, a
 * sibling-position locator -- correct today, but on the critical path of
 * every test in both word-count.spec.ts and essay-entry.spec.ts (every real
 * fill goes through `ensureEssayFormHydrated` first). Anyone wrapping the
 * counter in an extra `<div>` -- for layout, for a tooltip, for anything --
 * would silently break this locator, and every one of those tests would then
 * fail after the full 20s retry budget with `ensureEssayFormHydrated`'s own
 * "counter never reacted" message, which is about hydration, not markup --
 * a wrong diagnosis pointing away from the actual, one-line cause. A
 * `data-testid` survives exactly that kind of nearby markup change; a
 * sibling-position selector does not.
 */
function liveWordCountLocator(page: Page) {
  return page.getByTestId('essay-word-count');
}

/**
 * Proves the write page is genuinely interactive -- React has hydrated and
 * attached its `onChange` handler -- before any real content is filled.
 * See this file's own top comment for the race this closes and why a mere
 * wait on the counter's presence (it's server-rendered too) cannot.
 *
 * The probe's word count is derived, not fixed or merely-incrementing: it
 * has to differ from BOTH counts a false pass could otherwise borrow from --
 * the textarea's CURRENT raw DOM word count (read directly off
 * `inputValue()`, which works whether or not React has hydrated, since it's
 * just the DOM property, not the component's state) and `upcomingWordCount`,
 * the word count of the content the caller is about to fill for real once
 * this resolves.
 *
 * Round-1 review (blocking): the probe used to be sized off CURRENT alone
 * (current + 1). That guarantees a correctly processed probe changes the
 * rendered count relative to what was already there -- but on a fresh page
 * (current = 0) it is therefore always exactly one word, which renders
 * IDENTICALLY to whatever a one-word REAL fill would render next. A test
 * that fills one word first (`fillEssay(page, fx, 1)`, this suite's own
 * "singular and plural" test) had its post-fill "1 word" wait satisfied by
 * the probe's own leftover text before the real fill even ran -- caught on
 * webkit-desktop by deleting that real fill under mutation while leaving
 * everything else: on `main` (no hydration guard at all) two tests fail, as
 * they should; on the pre-fix version of THIS branch, both still passed,
 * because the one-word assertion was never actually exercising the real
 * fill. Deriving the probe from `max(current, upcoming) + 1` instead
 * removes that collision structurally, for every current/upcoming pair, not
 * just the one this test happened to surface.
 *
 * The `+ 1` is capped at `MAX_PROBE_WORD_COUNT` (below): `EssayEntryForm`'s
 * too-long block (`showTooLongError`) is deliberately NOT gated on having
 * submitted -- it's live, the same way the guidance/warning text is -- so
 * an uncapped probe filling at or above the 300-word ceiling would itself,
 * transiently, render a blocking "too long" alert while proving hydration.
 * No current call site fills that high, but nothing stops a future one, so
 * this stays inside the ceiling defensively: `pickProbeWordCount` prefers
 * `max(current, upcoming) + 1` when that's still under the cap (true for
 * every call site today), and falls back to counting down from the cap
 * itself, skipping only the (at most two) values current/upcoming already
 * hold, when it isn't.
 *
 * `timeout: 20_000` on the retry loop as a whole: generous enough to cover
 * a genuinely slow (not lost) hydration under real contention -- the same
 * kind of load that produced this race in the first place -- without being
 * indefinite. Once this resolves, hydration is a one-time event: it never
 * needs re-proving for the rest of the test, and on an already-hydrated
 * page (every call after the first in a test with more than one fill) it
 * resolves on the very first attempt, at negligible cost -- still runs a
 * probe fill each time, since a probe sized to also avoid `upcoming` is
 * exactly what keeps `fillTextboxAndWaitForWordCount`'s own after-fill wait
 * (below) honest on every call, not just the first (see that function's own
 * comment).
 */
// Mirrors MAX_ESSAY_WORDS (src/lib/contracts/word-count.ts) -- hardcoded
// rather than imported, matching this suite's existing convention of its
// own hand-written 300 (see LOCALE_FIXTURES' tooLongError text in both spec
// files): no e2e spec here imports application source today.
const MAX_PROBE_WORD_COUNT = 300;

function pickProbeWordCount(currentWordCount: number, upcomingWordCount: number): number {
  const aboveBoth = Math.max(currentWordCount, upcomingWordCount) + 1;
  if (aboveBoth <= MAX_PROBE_WORD_COUNT) return aboveBoth;
  for (let candidate = MAX_PROBE_WORD_COUNT; candidate >= 1; candidate -= 1) {
    if (candidate !== currentWordCount && candidate !== upcomingWordCount) return candidate;
  }
  // Unreachable: currentWordCount and upcomingWordCount are two numbers, so
  // they can exclude at most two of the MAX_PROBE_WORD_COUNT candidates
  // tried above. Kept only so the function has a total, honestly-typed
  // return rather than an implicit `undefined`.
  return MAX_PROBE_WORD_COUNT;
}

async function ensureEssayFormHydrated(page: Page, upcomingContent: string): Promise<void> {
  const textbox = page.getByRole('textbox');
  const counter = liveWordCountLocator(page);
  const upcomingWordCount = wordCount(upcomingContent);
  await expect(async () => {
    const currentValue = await textbox.inputValue();
    const probeWordCount = pickProbeWordCount(wordCount(currentValue), upcomingWordCount);
    const probeContent = Array.from({ length: probeWordCount }, (_, i) => `probe${i}`).join(' ');
    const before = await counter.textContent();
    await textbox.fill(probeContent);
    const after = await counter.textContent();
    // States what was observed, not a diagnosis of why -- a genuinely
    // hydrated page whose counter has itself stopped updating fails this
    // same assertion, and "the page is not hydrated yet" would be a
    // confident wrong cause in that case (round-2 review: reproduced by
    // simulating a hydrated page with a frozen counter and confirming this
    // assertion is what fails, in ~20s, not a hang).
    expect(
      after,
      'the live word counter did not change in response to a probe fill; either the page never hydrated or the counter itself is broken',
    ).not.toBe(before);
  }).toPass({ timeout: 20_000 });
}

/**
 * Fills the essay textarea and waits for the live word counter to reflect
 * `expectedCounterText` before returning. Two guards, not one:
 *
 *  1. `ensureEssayFormHydrated` (above) -- proves the page can react to an
 *     input at all, BEFORE the real fill, closing the total-loss race this
 *     file's top comment documents. Told `content` so its probe can also
 *     avoid colliding with the count `content` itself will produce (see
 *     that function's own comment for why that collision is exactly the
 *     round-1 finding on this fix).
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
 * Precondition, now guaranteed by construction rather than left to the
 * caller: the count shown on the page immediately before the real fill is
 * whatever `ensureEssayFormHydrated`'s own probe just left there, which is
 * ALWAYS different from `content`'s word count (that's what `pickProbeWordCount`
 * guarantees -- see `ensureEssayFormHydrated`'s comment). So the wait below
 * always observes a real transition onto `expectedCounterText`, never a
 * value already on the page when it starts -- including calling this
 * function twice in a row with the same count, which used to (round-1
 * finding) and no longer can silently pass on stale text. Still true, as
 * before: `expectedCounterText` must actually be what `content`'s word count
 * renders as -- that correspondence is the caller's job (see `wordCountText`
 * above and word-count.spec.ts's own `fillEssay`), not something this
 * function can check on its own.
 */
export async function fillTextboxAndWaitForWordCount(
  page: Page,
  content: string,
  expectedCounterText: string,
  timeout = 15_000,
): Promise<void> {
  await ensureEssayFormHydrated(page, content);
  await page.getByRole('textbox').fill(content);
  await expect(page.getByText(expectedCounterText, { exact: true })).toBeVisible({ timeout });
}
