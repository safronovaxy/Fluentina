/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { buildGradingResult, clampForSuspectedInjection, INJECTION_SUSPECTED_SCORE_CAP } from './result';
import { RUBRIC_DIMENSIONS, type ProviderGradingResponse } from '@/lib/contracts/grading';

function providerResponse(overallScore: number): ProviderGradingResponse {
  return {
    overallScore,
    summary: 'Summary.',
    dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: overallScore, comment: 'c' })),
    annotations: [],
  };
}

describe('buildGradingResult', () => {
  it('is not flagged for review by default, and derives the band from the score', () => {
    const result = buildGradingResult(providerResponse(80), []);
    expect(result.flaggedForReview).toBe(false);
    expect(result.overallScore).toBe(80);
    expect(result.overallBand).toContain('B2');
  });
});

describe('clampForSuspectedInjection — BR-3.5: an injection attempt must never silently return an inflated/perfect score', () => {
  it('caps a perfect score at the injection ceiling and marks the result flagged for review', () => {
    const perfect = buildGradingResult(providerResponse(100), []);

    const clamped = clampForSuspectedInjection(perfect);

    expect(clamped.overallScore).toBeLessThanOrEqual(INJECTION_SUSPECTED_SCORE_CAP);
    expect(clamped.overallScore).toBeLessThan(100);
    expect(clamped.flaggedForReview).toBe(true);
  });

  it('caps every per-dimension score too, not only the overall one', () => {
    const perfect = buildGradingResult(providerResponse(100), []);
    const clamped = clampForSuspectedInjection(perfect);
    for (const d of clamped.dimensions) {
      expect(d.score).toBeLessThanOrEqual(INJECTION_SUSPECTED_SCORE_CAP);
    }
  });

  it('recomputes the band off the capped score, never the original', () => {
    const perfect = buildGradingResult(providerResponse(100), []);
    const clamped = clampForSuspectedInjection(perfect);
    expect(clamped.overallBand).not.toBe(perfect.overallBand);
    expect(clamped.overallBand.toLowerCase()).not.toContain('strong');
  });

  it('never RAISES a genuinely low score toward the cap', () => {
    const low = buildGradingResult(providerResponse(20), []);
    const clamped = clampForSuspectedInjection(low);
    expect(clamped.overallScore).toBe(20);
  });
});
