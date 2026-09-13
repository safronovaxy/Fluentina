import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    },
  },
});
