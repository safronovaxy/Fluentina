/**
 * Shared console-error filter.
 *
 * Lived inside no-console-errors.spec.ts, but Playwright forbids one spec
 * importing another, and guest-flow.spec.ts needs the same list — a
 * filterless copy is simultaneously too brittle (third-party script hiccups
 * on a CI runner fail the test for reasons unrelated to the page) and too
 * easy to let drift from this one.
 */
export const IGNORED_PATTERNS = [
  /favicon/i,
  /ERR_BLOCKED_BY_CLIENT/i,   // ad blockers in CI
  /extension:\/\//i,          // browser extension noise
  /net::ERR_/i,               // network errors for 3rd party scripts (GA4 etc in CI)
  /Failed to load resource.*googletagmanager/i,
  /Failed to load resource.*growthbook/i,
  // CookieYes refuses to run on an unregistered origin and throws a page
  // error saying so. It fires on every page when the suite runs against
  // localhost or any preview host, and says nothing about our code.
  /cookieyes/i,
];

export function isCritical(text: string): boolean {
  return !IGNORED_PATTERNS.some((pattern) => pattern.test(text));
}
