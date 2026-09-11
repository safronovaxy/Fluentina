import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Fluentina regression tests.
 *
 * BASE_URL can be overridden to point at either:
 *   - The live site:  BASE_URL=https://fluentina.com npx playwright test
 *   - A local build:  BASE_URL=http://localhost:3000  npx playwright test
 *
 * Default falls back to the live production URL so the baseline can be
 * captured immediately without running a local server.
 */
const BASE_URL = process.env.BASE_URL ?? 'https://fluentina.com';

// Cloud Armor rate-limits at 100 req/min. When testing against production
// use 1 worker to avoid 429s. Local dev server (localhost) can use more.
const isProduction = BASE_URL.includes('fluentina.com');

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
    // Throttle requests against production to avoid Cloud Armor rate-limit
    // (100 req/min → 10-min ban). No delay needed for localhost.
    ...(isProduction ? { launchOptions: { slowMo: 500 } } : {}),
  },

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
