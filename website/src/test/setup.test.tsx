/**
 * Proves the Vitest wiring itself works, rather than assuming it.
 *
 * Until this PR there was no vitest.config.ts at all, so `npm run test` ran in
 * a node environment with src/test/setup.ts never loaded — a green suite that
 * exercised nothing. The only test in the repo was `expect(true).toBe(true)`
 * in a .ts file, which would still have passed under the broken setup.
 *
 * This file fails if any of the four things that config claims to deliver is
 * missing: the jsdom environment, the React/JSX transform, the jest-dom
 * matchers, and the matchMedia shim. KAN-8's component tests depend on all of
 * them, so the infrastructure PR is the right place to demonstrate it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

describe('vitest environment', () => {
  it('renders a real component through the JSX transform', () => {
    // No `import React` anywhere here: this only compiles under the automatic
    // runtime the React plugin applies.
    render(<Button>Start practising</Button>);
    expect(screen.getByRole('button', { name: 'Start practising' })).toBeInTheDocument();
  });

  it('resolves the @ alias and applies jest-dom matchers', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('provides the matchMedia shim from setup.ts', () => {
    expect(typeof window.matchMedia).toBe('function');
    expect(window.matchMedia('(min-width: 640px)').matches).toBe(false);
  });
});
