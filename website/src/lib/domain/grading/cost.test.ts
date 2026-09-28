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

  // KAN-44: the rates are Claude Opus 5.5's published $4 / $20 per MTok. Both
  // directions are pinned separately so a swapped or mistyped pair fails.
  it('claude is priced at its real rates — $4 per million prompt tokens and $20 per million completion tokens', () => {
    expect(estimateCostUsd('claude', 1_000_000, 0)).toBeCloseTo(4, 10);
    expect(estimateCostUsd('claude', 0, 1_000_000)).toBeCloseTo(20, 10);
  });

  it('claude costs something for any real call — a missing rate-table entry would throw here rather than log $0', () => {
    expect(estimateCostUsd('claude', 1700, 5200)).toBeGreaterThan(0);
  });

  it('KAN-16 round-1 review, finding 14: a provider name outside the union is a compile error, not a silent $0 at runtime', () => {
    // @ts-expect-error — 'gemini' is not a member of GradingProviderName.
    // `npm run typecheck` is what actually enforces this: the moment a name
    // IS added to the union (KAN-44 added 'claude' this way, and this line
    // used to use it), this directive stops erroring and `tsc` fails on the
    // now-unused `@ts-expect-error` — forcing whoever adds the provider to
    // also add its price to `APPROX_USD_PER_TOKEN` in cost.ts, in the same
    // commit, or the build itself is red, instead of every job silently
    // logging `costEstimateUsd: 0` forever.
    const notAProvider: GradingProviderName = 'gemini';
    void notAProvider;
  });
});
