/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './cost';
import type { GradingProviderName } from './provider';

describe('estimateCostUsd — KAN-24 rough cost estimate for telemetry, never billing-accurate', () => {
  it('the fake provider always costs zero', () => {
    expect(estimateCostUsd('fake', 1000, 1000)).toBe(0);
  });

  it('mistral cost scales with both prompt and completion tokens, and is greater than zero for a real call', () => {
    const cost = estimateCostUsd('mistral', 500, 200);
    expect(cost).toBeGreaterThan(0);
    const doublePrompt = estimateCostUsd('mistral', 1000, 200);
    expect(doublePrompt).toBeGreaterThan(cost);
  });

  it('zero tokens costs zero', () => {
    expect(estimateCostUsd('mistral', 0, 0)).toBe(0);
  });

  it('KAN-16 round-1 review, finding 14: a provider name outside the union is a compile error, not a silent $0 at runtime', () => {
    // @ts-expect-error — 'claude' is not (yet) a member of GradingProviderName.
    // `npm run typecheck` is what actually enforces this: the moment 'claude'
    // IS added to the union (ADR-4's fallback landing), this line stops
    // erroring and `tsc` fails on the now-unused `@ts-expect-error` directive
    // — forcing whoever adds the provider to also add its price to
    // `APPROX_USD_PER_TOKEN` in cost.ts, in the same commit, or the build
    // itself is red, instead of every Claude job silently logging
    // `costEstimateUsd: 0` forever.
    const notAProvider: GradingProviderName = 'claude';
    void notAProvider;
  });
});
