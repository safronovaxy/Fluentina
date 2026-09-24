import { defineConfig, devices } from '@playwright/test';
import { readdirSync } from 'fs';
import path from 'path';

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
// tests/word-count.spec.ts — see each file's own comment, and
// tests/helpers/webkit.ts for the shared `browserName`-derived predicate
// they all key off as of KAN-33) only checks whether BASE_URL is plain
// HTTP, and a Playwright skip is not a failure: if the proxy steps in
// ci.yml are ever dropped or reordered, or a merge resolution restores the
// plain address, the twelve tests (six in guest-session.spec.ts including
// KAN-33's own maxAge assertion, four in essay-entry.spec.ts, two in
// word-count.spec.ts — eleven before that addition) go straight back to
// silently skipping and the job stays green — exactly the drift this story
// exists to end, and the reason the skip condition has already drifted
// silently three times across earlier stories. So: in the pipeline
// specifically, an unencrypted BASE_URL is not "skip", it's broken — throw
// instead.
if (process.env.CI && process.env.BASE_URL && !process.env.BASE_URL.startsWith('https://')) {
  throw new Error(
    'KAN-30/KAN-33: BASE_URL is not HTTPS in CI. The Safari (webkit-desktop, ' +
      'webkit-mobile) cookie tests silently skip over a plain connection ' +
      'instead of failing — see tests/guest-session.spec.ts for why — so this ' +
      'is a broken pipeline, not a thing to skip past. Check that ci.yml still ' +
      'generates the TLS cert, starts scripts/tls-proxy.mjs, and points ' +
      'BASE_URL at it.',
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

// KAN-33: seo.spec.ts, redirects.spec.ts, routing.spec.ts and sitemap.spec.ts
// each pin themselves to Chromium (`test.use({ browserName: 'chromium' })`,
// every one of those files' own comment) and take only the `request`
// fixture, never `page` — so no browser engine launches for them at all, in
// any project (routing.spec.ts's own "Only run in one project — this is pure
// HTTP, no browser rendering needed" comment predates this list and was
// aspirational until now). Before this, all four still ran once per project
// anyway — three redundant, engine-less executions of the same pure-HTTP
// assertions, which is what these four specs' counts used to look like on
// webkit-desktop (CONTRIBUTING.md's own "WebKit gates every PR" bullet
// documented the discrepancy rather than fixing it; this list is the fix,
// for these four files specifically — it does not make every project's count
// otherwise-honest; see CONTRIBUTING.md for the one still-request-only test
// this list doesn't and shouldn't touch). Listed once here and excluded from
// every project below except chromium-desktop (the one project whose
// `browserName` they already force), so each test in these four files
// executes exactly once across the whole pipeline, not zero and not three
// times.
//
// Anchored to the whole file name (`[\/]name\.spec\.ts$`), not just a
// suffix: `testIgnore` matches against the *full path*, so an unanchored
// `/seo\.spec\.ts$/` also matches something like `tests/blog-seo.spec.ts` or
// any future spec that merely ends in the same characters — silently
// dropping an unrelated file from three of the four projects with no error
// anywhere (round-1 review, reproduced independently by both reviewers with
// `--list`). No `(^|...)` alternative: Playwright matches `testIgnore`
// against the file's *absolute* path, which never starts with the bare file
// name, so that branch was dead weight — round-2 review (SA) found it worse
// than dead, because it let a `^`-anchored typo like `/^seo\.spec\.ts$/`
// pass the guard below (which, before this fix, tested relative paths) while
// matching nothing at all once Playwright applied it for real, silently
// widening webkit-mobile from 94 tests to 154. The guard right below now
// tests the same absolute-path form Playwright does, so that class of typo
// fails the guard instead of passing it.
const REQUEST_ONLY_SPECS = [
  /[\\/]seo\.spec\.ts$/,
  /[\\/]redirects\.spec\.ts$/,
  /[\\/]routing\.spec\.ts$/,
  /[\\/]sitemap\.spec\.ts$/,
];

// Any file whose test framework a Playwright project might collect — kept in
// sync with `testMatch` below (widened past `.spec.ts` there for the same
// reason: a future `.spec.tsx` or `.spec.js` file must not go uncollected by
// both this guard and testMatch while looking, at a glance, exactly like
// every other spec).
const SPEC_FILE_PATTERN = /\.spec\.[cm]?[jt]sx?$/;

// Belt-and-braces for the anchoring fix above: walk the real files under
// tests/ (Playwright's own testDir), build each one's *absolute* path — the
// same form Playwright's testIgnore matching uses — and require each
// REQUEST_ONLY_SPECS pattern to match exactly one of them. Zero matches
// means a rename broke the pattern, or (round-2 review) an over-anchored
// pattern like `/^seo\.spec\.ts$/` was never going to match a real absolute
// path in the first place; more than one means the pattern is broader than a
// single file again. Either way this throws at config-load time instead of
// quietly narrowing (or widening) which specs get excluded — this guard only
// catches a pattern/file-count mismatch, not every way testIgnore could
// still misbehave, so it's not a substitute for checking `--list` counts too.
const testDir = path.join(__dirname, 'tests');
{
  const testFiles = readdirSync(testDir, { recursive: true })
    .map((f) => path.join(testDir, String(f)))
    .filter((f) => SPEC_FILE_PATTERN.test(f));
  for (const pattern of REQUEST_ONLY_SPECS) {
    const matches = testFiles.filter((f) => pattern.test(f));
    if (matches.length !== 1) {
      throw new Error(
        `REQUEST_ONLY_SPECS entry ${pattern} must match exactly one file under tests/, ` +
          `matched ${matches.length}: ${matches.join(', ') || '(none)'}`,
      );
    }
  }
}

export default defineConfig({
  testDir: './tests',
  // tests/helpers/webkit.test.ts is a Vitest unit test (added for finding 3
  // of the KAN-33 revision — a plain-Vitest truth table for
  // `isWebKitOverPlainHttp`, since no Playwright run can catch an
  // over-skipping mutant: a skip isn't a failure), not a Playwright spec.
  // Playwright's default testMatch picks up any `*.test.ts` under testDir
  // just as readily as `*.spec.ts`, and `vitest` can't be `require()`d from
  // Playwright's runner. Pinning testMatch to the same SPEC_FILE_PATTERN the
  // REQUEST_ONLY_SPECS guard above uses — any `.spec.ts`/`.spec.tsx`/
  // `.spec.js`/`.spec.mjs`/`.spec.cjs` file, not `.spec.ts` only (round-2
  // review: a future `.spec.tsx` or `.spec.js` file would otherwise be
  // collected by nothing at all, silently) — rather than adding a
  // `testIgnore` for this one file, is what keeps this working on every
  // project, not just the ones without their own `testIgnore`: a
  // project-level `testIgnore` array (chromium-mobile, webkit-desktop,
  // webkit-mobile all set one, for REQUEST_ONLY_SPECS) replaces this
  // top-level one for that project rather than merging with it, so a
  // root-level `testIgnore` here would silently stop applying on exactly
  // those three projects — `testMatch`, left unset on every project, stays
  // inherited from here everywhere instead.
  testMatch: SPEC_FILE_PATTERN,
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
      testIgnore: REQUEST_ONLY_SPECS,
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
      testIgnore: REQUEST_ONLY_SPECS,
    },
    {
      // KAN-33 — mobile Safari. Desktop WebKit (above, KAN-30) closed the
      // engine-level gap (does Safari store and return the guest session
      // cookie) — that behaviour is identical on mobile, so desktop coverage
      // closed it for good. What's NOT engine-level, and stayed uncovered
      // without this project, is everything iPhone-shaped that isn't the
      // cookie: viewport-differential rendering (tests/guest-flow.spec.ts's
      // own mobile-collapse assertions) at a real phone width under a real
      // Safari layout engine, not Chromium's — the only mobile signal in the
      // suite before this was chromium-mobile, a different engine entirely.
      // iPhone 13 (390px), not a Chromium-only "Pixel 5 but WebKit" fiction —
      // it's a real, current device preset Playwright ships for WebKit, and
      // its width (390px) sits on the same side of every breakpoint this
      // suite's assertions key off (Tailwind's `md`, 768px) as chromium-
      // mobile's Pixel 5 (393px), so the two mobile projects exercise the
      // same responsive branches, just through different engines.
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      testIgnore: REQUEST_ONLY_SPECS,
    },
  ],
});
