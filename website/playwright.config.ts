import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Fluentina regression tests.
 *
 * BASE_URL can be overridden to point at either:
 *   - A local build:  BASE_URL=http://localhost:3000  npx playwright test
 *   - The live site:  BASE_URL=https://write-wise.com npx playwright test
 *
 * The default is localhost, and `webServer` below builds and starts the app,
 * so `npm run test:e2e` works from a clean checkout with nothing running.
 *
 * It used to default to https://fluentina.com. That domain resolves but does
 * not serve yet — DNS cutover is still pending — so every spec failed on a
 * connection timeout rather than on anything about the code. Live runs go
 * through `npm run test:e2e:live`, which sets BASE_URL explicitly.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// Fail loudly rather than silently testing production: if CI ever loses its
// BASE_URL, we want a broken config, not a green run against the live site.
if (process.env.CI && !process.env.BASE_URL) {
  throw new Error('BASE_URL must be set explicitly in CI');
}

// KAN-30 round-1 review (blocking, found independently by both reviewers):
// the whole point of this story is that ci.yml's pipeline run goes through
// scripts/tls-proxy.mjs and is therefore encrypted — that's what lets
// WebKit store the __Host--prefixed session cookie at all. The three specs'
// skip predicate (tests/guest-session.spec.ts, tests/essay-entry.spec.ts,
// tests/word-count.spec.ts — see each file's own comment) only checks
// whether BASE_URL is plain HTTP, and a Playwright skip is not a failure:
// if the proxy steps in ci.yml are ever dropped or reordered, or a merge
// resolution restores the plain address, the eleven tests go straight back
// to silently skipping and the job stays green — exactly the drift this
// story exists to end, and the reason the skip condition has already
// drifted silently three times across earlier stories. So: in the
// pipeline specifically, an unencrypted BASE_URL is not "skip", it's
// broken — throw instead.
if (process.env.CI && process.env.BASE_URL && !process.env.BASE_URL.startsWith('https://')) {
  throw new Error(
    'KAN-30: BASE_URL is not HTTPS in CI. The Safari (webkit-desktop) cookie ' +
      'tests silently skip over a plain connection instead of failing — see ' +
      'tests/guest-session.spec.ts for why — so this is a broken pipeline, not ' +
      'a thing to skip past. Check that ci.yml still generates the TLS cert, ' +
      'starts scripts/tls-proxy.mjs, and points BASE_URL at it.',
  );
}

// Cloud Armor rate-limits at 100 req/min. When testing against production
// use 1 worker to avoid 429s. Local dev server (localhost) can use more.
//
// Also used below to scope ignoreHTTPSErrors: this is `false` for both a
// local `http://localhost:...` run AND the pipeline's `https://localhost:...`
// run through the self-signed TLS proxy, and `true` only for a real
// domain (write-wise.com, and fluentina.com once DNS cuts over) — which is
// exactly the line between "the cert is intentionally untrusted" and "the
// cert is supposed to be real".
const isProduction = !BASE_URL.includes('localhost');

export default defineConfig({
  testDir: './tests',
  fullyParallel: !isProduction,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: isProduction ? 1 : (process.env.CI ? 4 : 2),
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Give SSR pages a fair timeout — cold-start Cloud Run can be slow
    navigationTimeout: 20_000,
    actionTimeout: 10_000,
    // KAN-30 round-1 review (should-fix, found independently by both
    // reviewers): this used to be unconditional, on the claim that live/
    // production runs "still verify nothing was actually mis-served" — they
    // don't verify anything of the kind once this is on; the only
    // encryption-related assertion anywhere in the specs checks link text,
    // not the transport. A live run needs real cert verification precisely
    // because a mismatch on the production domain is scheduled, not
    // hypothetical: the current managed certificate covers the old domain
    // only, and a managed certificate's domain list can't be edited — a new
    // one has to be provisioned before the fluentina.com cutover (see
    // CUSTOM_DOMAIN_SETUP.md). Turning this off unconditionally means a
    // missing or mismatched cert on cutover day shows every real browser a
    // warning while this suite reports green. So: on for the pipeline/local
    // runs against the self-signed proxy (isProduction is false for both —
    // see its own comment above), off for anything hitting a real domain.
    // Verified both halves (Architect): with this off, Safari refuses the
    // connection outright; with it on, the page loads and the cookie stores.
    ...(!isProduction ? { ignoreHTTPSErrors: true } : {}),
    // Throttle requests against production to avoid Cloud Armor rate-limit
    // (100 req/min → 10-min ban). No delay needed for localhost.
    ...(isProduction ? { launchOptions: { slowMo: 500 } } : {}),
  },

  // Start a server only when nobody else owns the lifecycle.
  //
  // ci.yml builds and starts the app itself, so Playwright must not also try:
  // its webServer plugin throws when the URL already answers and
  // reuseExistingServer is false, which aborts the run before a single test
  // executes. Setting reuseExistingServer: true unconditionally would "fix"
  // CI at the cost of silently testing a stale server locally, so the block is
  // skipped entirely when a server is supplied externally instead.
  //
  // PLAYWRIGHT_EXTERNAL_SERVER is set by ci.yml. Keying off CI alone would
  // break any future workflow that wants Playwright to own the lifecycle.
  ...(isProduction || process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? {}
    : {
        webServer: {
          command: 'npm run build && npm run start',
          url: BASE_URL,
          // Locally, reuse a dev server you already have running rather than
          // shadowing it with a second one.
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'webkit-desktop',
      // This project's own reported test count overstates real Safari
      // coverage: seo.spec.ts, redirects.spec.ts, routing.spec.ts, and
      // sitemap.spec.ts (94 of 187 tests under this project, per
      // `--project=webkit-desktop --grep-invert "@cms" --list`) take only
      // the `request` fixture and never open a `page`, so no browser engine
      // launches for them here — not WebKit, not Chromium, none. See
      // CONTRIBUTING.md's "WebKit gates every PR" bullet for the full note.
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
