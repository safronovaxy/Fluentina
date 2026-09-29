import { type Page } from '@playwright/test';

/**
 * Waits until React has hydrated the element matching `selector`.
 *
 * The auth forms are server-rendered, so their inputs exist and accept a
 * `fill()` in the markup the browser paints before any client JavaScript has
 * run. Input typed in that window reaches no handler, and hydration then
 * commits React's own empty state over it — the race
 * `tests/helpers/essay-fill.ts` documents at length for the essay textarea.
 * That helper proves hydration by making a counter react to a probe fill,
 * which needs a live counter; these forms have none, so this asks the DOM
 * directly: React attaches its props object to an element under a
 * `__reactProps$…` key when it hydrates it, and never on server markup.
 * That key is a React internal, not an API — if a React upgrade renames it
 * this waits out its timeout and fails loudly with the message below, rather
 * than passing wrongly.
 */
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForFunction(
      (sel) => {
        const element = document.querySelector(sel);
        return !!element && Object.keys(element).some((key) => key.startsWith('__reactProps$'));
      },
      selector,
      { timeout: 20_000 },
    );
  } catch {
    throw new Error(
      `"${selector}" was not hydrated within 20s. Either the page's client bundle never ran, or React no longer ` +
        'marks hydrated elements with a `__reactProps$` key (see tests/helpers/hydration.ts).',
    );
  }
}
