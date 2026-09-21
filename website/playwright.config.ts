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

// Cloud Armor rate-limits at 100 req/min. When testing against production
// use 1 worker to avoid 429s. Local dev server (localhost) can use more.
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
    // KAN-30: the pipeline run is served through scripts/tls-proxy.mjs's
    // self-signed cert, not a trusted CA — Chromium and WebKit alike would
    // otherwise refuse the connection outright before a single test could
    // run. Harmless against a real certificate too (live/production runs
    // still verify nothing was actually mis-served; this only turns off the
    // browser's own chain-of-trust check on the way in), so it's unconditional
    // rather than gated on BASE_URL.
    ignoreHTTPSErrors: true,
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
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
