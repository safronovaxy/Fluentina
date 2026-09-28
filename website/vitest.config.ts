import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { config as loadEnv } from 'dotenv';

// Vitest doesn't load .env.local the way `next dev`/`next build` do — KAN-10's
// data-layer tests need DATABASE_URL to reach the local Postgres started by
// `docker compose up -d db`, so it's loaded explicitly here. quiet: true —
// see the comment in drizzle.config.ts on dotenv@17's self-promotional
// console "tips".
loadEnv({ path: '.env.local', quiet: true });

// Vitest was scaffolded with @testing-library/react + jest-dom + a jsdom
// matchMedia mock (src/test/setup.ts) but had no config wiring them in —
// this fills that gap so component tests (e.g. KAN-8's responsive layout
// tests) actually run in a DOM environment with the right matchers.
export default defineConfig({
  // Required: website/tsconfig.json sets "jsx": "preserve" for Next, so
  // Vitest's bare esbuild transform leaves JSX in the output and every .tsx
  // test fails to run. The plugin applies the automatic JSX runtime, which is
  // also why the test files need no `import React`.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Bare 'node_modules' is not a recursive glob; keep Vitest's defaults and
    // add to them rather than replacing the list.
    exclude: ['**/node_modules/**', '**/.next/**', 'tests/**'],
    env: {
      // KAN-16 round-1 review, finding 1: this MUST live here, not in
      // ci.yml, and not rely on a developer's own gitignored `.env.local`.
      // `createGradingProvider()` (provider-factory.ts) falls through to the
      // REAL Mistral provider whenever this isn't the literal string '1' —
      // that's ADR-4's own default. A local `.env.local` (every developer
      // machine that's ever run `npm run dev`) sets it, so the suite looked
      // green; CI has no such file, so the exact same suite constructed the
      // real provider, found no `MISTRAL_API_KEY`, and failed — while
      // `essays/route.test.ts`'s own rate-limit fixtures alone fire off
      // close to 300 unawaited grading jobs per run that would otherwise
      // each reach for it. Setting it here, in the one config file both
      // environments load, makes local and CI runs identical instead of
      // merely "usually agreeing". `src/test/setup.ts` adds a second,
      // independent layer (a fetch guard) so a future regression here still
      // can't reach a real network host.
      MOCK_GRADING_PROVIDER: '1',
      // GRADING_QUEUE_MODE=off: see queue.ts's own comment. Submitting an
      // essay normally fires the grading job inline, unawaited, the instant
      // the job is enqueued — across this suite's ~300 essay submissions
      // (most of them KAN-25 rate-limit fixtures with no interest in
      // grading at all) that raced this file's own `afterEach`
      // TRUNCATE (db-fixtures.ts), reproducibly leaking a job into an
      // unrelated test. 'off' records the job id and runs nothing; the two
      // tests that actually want to see a job finish
      // (`essays/route.test.ts`'s KAN-16 describe block) drain it
      // explicitly via `drainGradingQueueForTests()`.
      GRADING_QUEUE_MODE: 'off',
    },
    // KAN-10's lib/db test files all share one real Postgres database and
    // TRUNCATE it between tests (src/test/db-fixtures.ts::resetDatabase). Running
    // test files in parallel (Vitest's default) lets one file's reset race
    // another file's still-running assertions against the same tables —
    // observed directly as spurious FK-violation failures before this was
    // added. The whole suite is small enough that serial execution is cheap.
    fileParallelism: false,
    server: {
      deps: {
        // KAN-9: by default Vitest "externalizes" node_modules deps —
        // loading them with Node's native ESM loader instead of putting
        // them through Vite's own resolution/transform. Node's ESM loader,
        // unlike `require`, does not probe for a missing file extension, so
        // next-intl's `import ... from 'next/navigation'` (extensionless,
        // and `next`'s package.json has no "exports" map to resolve it)
        // fails with "Cannot find module ... Did you mean
        // next/navigation.js". Inlining next-intl routes it through Vite's
        // resolver instead, which does add the extension. Test files still
        // `vi.mock('next/navigation', ...)` to stub it — this only fixes
        // resolving the *real* module underneath that mock.
        inline: ['next-intl'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // See src/test/server-only-stub.ts: `server-only` throws unless
      // resolved through Next's `react-server` bundler condition, which
      // Vitest never sets, so every lib/db and lib/domain module (KAN-10)
      // would fail to import here without this.
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
});
