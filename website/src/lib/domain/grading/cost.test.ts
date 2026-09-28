/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './cost';

describe('estimateCostUsd — KAN-24 rough cost estimate for telemetry, never billing-accurate', () => {
  it('the fake provider always costs zero', () => {
    expect(estimateCostUsd('fake', 1000, 1000)).toBe(0);
  });

  it('an unrecognised provider name costs zero rather than throwing', () => {
    expect(estimateCostUsd('unknown-provider', 1000, 1000)).toBe(0);
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
});
