import { describe, expect, it } from 'vitest';
import { RUBRIC_DIMENSIONS, bandForScore, providerGradingResponseSchema } from './grading';

function validDimensions(score = 70) {
  return RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score, comment: `Comment for ${dimension}.` }));
}

function validResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    overallScore: 70,
    summary: 'A solid B2-level essay overall.',
    dimensions: validDimensions(),
    annotations: [],
    ...overrides,
  };
}

describe('providerGradingResponseSchema', () => {
  it('accepts a well-formed response covering all four rubric dimensions exactly once', () => {
    const result = providerGradingResponseSchema.safeParse(validResponse());
    expect(result.success).toBe(true);
  });

  it('BR-3.1: rejects a response missing one of the four required rubric dimensions', () => {
    const withoutOne = validDimensions().slice(0, 3);
    const result = providerGradingResponseSchema.safeParse(validResponse({ dimensions: withoutOne }));
    expect(result.success).toBe(false);
  });

  it('rejects a response scoring one dimension twice instead of covering all four', () => {
    const duplicated = [...validDimensions().slice(0, 3), { dimension: RUBRIC_DIMENSIONS[0], score: 50, comment: 'dup' }];
    const result = providerGradingResponseSchema.safeParse(validResponse({ dimensions: duplicated }));
    expect(result.success).toBe(false);
  });

  it('rejects an overall score outside 0-100', () => {
    expect(providerGradingResponseSchema.safeParse(validResponse({ overallScore: 101 })).success).toBe(false);
    expect(providerGradingResponseSchema.safeParse(validResponse({ overallScore: -1 })).success).toBe(false);
  });

  it('BR-3.3: rejects an annotation with no quote — an annotation with no span to verify is meaningless', () => {
    const result = providerGradingResponseSchema.safeParse(
      validResponse({
        annotations: [{ quote: '', dimension: RUBRIC_DIMENSIONS[0], severity: 'minor', message: 'x' }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts an annotation with a quote and an optional suggestion', () => {
    const result = providerGradingResponseSchema.safeParse(
      validResponse({
        annotations: [
          { quote: 'ein Fehler', dimension: RUBRIC_DIMENSIONS[2], severity: 'major', message: 'Grammar issue.', suggestion: 'ein Fehler -> einen Fehler' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('bandForScore', () => {
  it('is deterministic and boundary-inclusive on the low edge of each band', () => {
    expect(bandForScore(90)).toContain('B2+');
    expect(bandForScore(89)).not.toContain('B2+');
    expect(bandForScore(75)).toContain('B2 (pass)');
    expect(bandForScore(60)).toContain('borderline');
    expect(bandForScore(40)).toContain('B1');
    expect(bandForScore(0)).toContain('Below B1');
  });
});
