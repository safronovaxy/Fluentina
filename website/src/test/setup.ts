// The /vitest entry is what registers the matchers when `globals` is off.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library auto-cleans between tests only when Vitest `globals` is on,
// which it is not here. Without this, every render stays in the document and
// later tests see the accumulated DOM — queries fail with "found multiple
// elements", or worse, silently match an element from an earlier test.
afterEach(cleanup);

// Guarded (KAN-9): this setupFile runs for every test file, and a file may
// opt into the `node` environment with a `@vitest-environment node` docblock,
// where `window` does not exist. No file does so today — request.test.ts
// mocks next-intl/server instead of switching environment — so this guard is
// currently always true. It stays because the data-layer tests arriving with
// KAN-10 do need the node environment, and without it they would fail here
// before running.
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
