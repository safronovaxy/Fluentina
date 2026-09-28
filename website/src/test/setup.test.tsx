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

  // KAN-16 round-1 review, finding 1 — the belt-and-suspenders fetch guard.
  // See setup.ts's own comment: this exists specifically so that if
  // vitest.config.ts's `MOCK_GRADING_PROVIDER: '1'` default ever regresses,
  // the suite fails loudly the instant something reaches for a real network
  // host, rather than silently billing a real provider.
  it('throws — never silently reaches the network — when something calls fetch against a non-localhost host without stubbing it first', () => {
    expect(() => fetch('https://api.mistral.ai/v1/chat/completions')).toThrow(/real network fetch/i);
  });

  it('still lets a localhost fetch through to the real implementation, rather than blocking everything', async () => {
    // Nothing is listening on this port — this only proves the guard let the
    // call REACH the real fetch (a network-level rejection), not that the
    // guard's own "stub it yourself" error fired.
    await expect(fetch('http://127.0.0.1:1')).rejects.not.toThrow(/real network fetch/i);
  });
});
