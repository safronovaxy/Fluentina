/**
 * Shared console-error filter.
 *
 * Lived inside no-console-errors.spec.ts, but Playwright forbids one spec
 * importing another, and guest-flow.spec.ts needs the same list — a
 * filterless copy is simultaneously too brittle (third-party script hiccups
 * on a CI runner fail the test for reasons unrelated to the page) and too
 * easy to let drift from this one.
 */
// The suite runs against production too (npm run test:e2e:live), where these
// errors are real. Anything origin-specific belongs below, not here.
const isLocalRun = !/^https?:\/\/(www\.)?(fluentina|write-wise)\.com/.test(
  process.env.BASE_URL ?? 'http://localhost:3000',
);

export const IGNORED_PATTERNS = [
  /favicon/i,
  /ERR_BLOCKED_BY_CLIENT/i,   // ad blockers in CI
  /extension:\/\//i,          // browser extension noise
  /net::ERR_/i,               // network errors for 3rd party scripts (GA4 etc in CI)
  /Failed to load resource.*googletagmanager/i,
  /Failed to load resource.*growthbook/i,
];

/**
 * Ignored only on non-production origins.
 *
 * CookieYes refuses to run on an origin not registered to the account and
 * throws a page error saying so, which fires on every page when the suite runs
 * against localhost. On production that same error is the only signal that the
 * consent banner is not rendering — and DNS cutover to a new domain is exactly
 * the event that makes a production origin unregistered. Swallowing it there
 * would mean GDPR consent silently absent with a green suite.
 */
const LOCAL_ONLY_PATTERNS = [/cookieyes/i];

export function isCritical(text: string): boolean {
  const patterns = isLocalRun
    ? [...IGNORED_PATTERNS, ...LOCAL_ONLY_PATTERNS]
    : IGNORED_PATTERNS;
  return !patterns.some((pattern) => pattern.test(text));
}
