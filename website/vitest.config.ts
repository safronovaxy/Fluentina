import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest was scaffolded with @testing-library/react + jest-dom + a jsdom
// matchMedia mock (src/test/setup.ts) but had no config wiring them in —
// this fills that gap so component tests (e.g. KAN-8's responsive layout
// tests) actually run in a DOM environment with the right matchers.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
