// The /vitest entry is what registers the matchers when `globals` is off.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * KAN-16 round-1 review, finding 1 — the second, independent half of the
 * fix. `vitest.config.ts`'s `MOCK_GRADING_PROVIDER: '1'` default is what
 * actually makes the suite hermetic; this is the belt to that suspenders,
 * for the day that config-level default regresses (a rename, a merge
 * conflict, a future contributor moving it "temporarily" while debugging).
 * Without ANY guard, that single line breaking silently turns
 * `createGradingProvider()` back into the real Mistral provider inside the
 * unit suite — and `essays/route.test.ts`'s own rate-limit fixtures alone
 * fire close to 300 grading jobs per run, each of which would reach for it.
 *
 * Replaces the real global `fetch` with one that only a test's OWN
 * `vi.stubGlobal('fetch', ...)` can shadow (restored to THIS guarded
 * version by that test's own `vi.unstubAllGlobals()` in `afterEach`).
 * Every test in this suite that touches `fetch` at all already stubs it
 * itself (`mistral-provider.test.ts`, `queue.test.ts`,
 * `EssayEntryForm.test.tsx`, `GuestSessionBootstrap.test.tsx`) — nothing
 * here is expected to ever reach this guarded function. Localhost is left
 * open rather than blocked outright, in case a future integration test
 * legitimately needs to hit a locally-served endpoint; nothing does today.
 */
function isLocalHost(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url, "http://localhost").hostname);
  } catch {
    return false;
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!isLocalHost(url)) {
    throw new Error(
      `Test attempted a real network fetch to "${url}" without stubbing \`fetch\` itself. ` +
        "Every unit test must stub fetch (vi.stubGlobal('fetch', ...)) rather than reach a real " +
        "host — this guard exists specifically so a MOCK_GRADING_PROVIDER regression (KAN-16 " +
        "round-1 review, finding 1) fails loudly here instead of silently billing a real provider.",
    );
  }
  return realFetch(input, init);
}) as typeof fetch;

// This file runs as a global setupFile, so it also loads for KAN-10's
// data-layer tests, which override to `@vitest-environment node` per file
// (no `window`/`document` at all) because they exercise lib/db against a
// real Postgres, not a DOM. Everything below is jsdom-only; guarding it
// keeps one shared setup file instead of forking it per environment.
if (typeof window !== "undefined") {
  // Testing Library auto-cleans between tests only when Vitest `globals` is
  // on, which it is not here. Without this, every render stays in the
  // document and later tests see the accumulated DOM — queries fail with
  // "found multiple elements", or worse, silently match an element from an
  // earlier test.
  afterEach(cleanup);

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
