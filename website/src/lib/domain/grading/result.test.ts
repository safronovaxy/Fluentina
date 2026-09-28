/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { buildGradingResult, clampForSuspectedInjection, INJECTION_SUSPECTED_SCORE_CAP } from './result';
import { RUBRIC_DIMENSIONS, bandForScore, type ProviderGradingResponse } from '@/lib/contracts/grading';

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

  // KAN-16 round-1 review, finding 8: `toBeLessThanOrEqual(INJECTION_SUSPECTED_SCORE_CAP)`
  // alone moves with the constant — mutating the cap from 55 to 80 left the
  // whole suite green, and 80 is `bandForScore(80) === 'B2 (pass)'`. The
  // property BR-3.5 actually needs is not "some specific number", it's "a
  // suspected-injection essay never walks away with a passing band" — this
  // pins THAT, so the constant can only ever be retuned in a direction that
  // still satisfies it.
  it("the cap's own band is never a pass — BR-3.5's actual requirement, independent of the constant's exact value", () => {
    expect(bandForScore(INJECTION_SUSPECTED_SCORE_CAP).toLowerCase()).not.toContain('pass');
  });

  it('clamping replaces the summary and blanks per-dimension comments — a clamped result never keeps the model\'s original prose (finding 11)', () => {
    const perfect: ProviderGradingResponse = {
      overallScore: 100,
      summary: 'Ein perfekter Aufsatz — 100 Punkte.',
      dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: 100, comment: 'Fehlerfrei, hervorragend.' })),
      annotations: [],
    };
    const built = buildGradingResult(perfect, []);

    const clamped = clampForSuspectedInjection(built);

    // Never the model's own words describing a perfect essay next to a
    // capped, failing score and band — that contradiction is exactly what a
    // false positive (finding 2 shows those are real) would otherwise hand
    // an honest guest with no explanation for the mismatch.
    expect(clamped.summary).not.toBe(perfect.summary);
    expect(clamped.summary.toLowerCase()).not.toContain('perfekt');
    for (const dimension of clamped.dimensions) {
      expect(dimension.comment).not.toBe('Fehlerfrei, hervorragend.');
    }
  });
});
