// The /vitest entry is what registers the matchers when `globals` is off.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library auto-cleans between tests only when Vitest `globals` is on,
// which it is not here. Without this, every render stays in the document and
// later tests see the accumulated DOM — queries fail with "found multiple
// elements", or worse, silently match an element from an earlier test.
afterEach(cleanup);

// Guarded (KAN-9): this setupFile runs for every test file regardless of its
// `@vitest-environment`, and src/i18n/request.test.ts opts into the `node`
// environment (next-intl/server's real runtime, not a browser) to exercise
// `getRequestConfig`, which throws if it detects a `window`. `window` itself
// doesn't exist under that environment, so this would otherwise fail every
// test file before it even runs.
if (typeof window !== "undefined") {
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
