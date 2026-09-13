// The /vitest entry is what registers the matchers when `globals` is off.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library auto-cleans between tests only when Vitest `globals` is on,
// which it is not here. Without this, every render stays in the document and
// later tests see the accumulated DOM — queries fail with "found multiple
// elements", or worse, silently match an element from an earlier test.
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
