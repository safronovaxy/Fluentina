import 'server-only';

/**
 * KAN-16 — the deterministic fake `GradingProvider`, zero network calls.
 * This is what `MOCK_GRADING_PROVIDER=1` (already provisioned in `ci.yml`
 * ahead of this story) selects in `provider-factory.ts`, and what every
 * vitest/Playwright run exercises the grading pipeline through — "testable
 * with zero network calls" (the ticket's own constraint) means this file,
 * not a mocked `fetch`.
 *
 * Two shapes:
 *
 * - `createFakeGradingProvider()` — the default used by the env-based
 *   factory. Deterministic and always well-formed: every annotation's
 *   `quote` is copied verbatim from the input essay content (the first
 *   `wordCount` tokens' worth, roughly), so `resolveAnnotationSpans` always
 *   succeeds against it and an end-to-end poll-until-succeeded test has
 *   something real to observe. The score is derived from the word count
 *   only (never from content, which would make results depend on what a
 *   real learner happened to write, defeating the point of a fixture) so
 *   the same essay length always produces the same result.
 * - `createFakeGradingProvider(overrides)` — a test that needs a SPECIFIC
 *   response shape (an out-of-bounds score, an unresolvable quote, a
 *   thrown `GradingProviderError`) passes `overrides.response` or
 *   `overrides.raw`/`overrides.throws` directly; nothing here re-derives
 *   scenario-specific behaviour from a mode flag, so a new test scenario
 *   never means editing this file.
 */
import { RUBRIC_DIMENSIONS, type ProviderGradingResponse } from '@/lib/contracts/grading';
import type { GradingProvider, GradingProviderInput, GradingProviderOutput } from '../provider';

export interface FakeGradingProviderOverrides {
  /** When set, `grade()` throws this instead of returning — for testing the failure path. */
  readonly throws?: Error;
  /** When set, used verbatim as the parsed response instead of the deterministic default. */
  readonly response?: ProviderGradingResponse;
}

function defaultResponse(essayContent: string, wordCount: number): ProviderGradingResponse {
  // A score in [50, 90], purely a function of word count — deterministic,
  // never a function of essay CONTENT itself (see this file's own comment).
  const score = 50 + (wordCount % 41);
  const firstWord = essayContent.trim().split(/\s+/)[0] ?? 'Text';
  return {
    overallScore: score,
    summary: `Fake grading of a ${wordCount}-word essay (test/CI fixture — no real model was called).`,
    dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({
      dimension,
      score,
      comment: `Deterministic fixture score for ${dimension}.`,
    })),
    annotations: [
      {
        quote: firstWord,
        dimension: RUBRIC_DIMENSIONS[0],
        severity: 'minor',
        message: 'Fixture annotation — quote copied verbatim from the essay so span resolution always succeeds.',
      },
    ],
  };
}

export function createFakeGradingProvider(overrides: FakeGradingProviderOverrides = {}): GradingProvider {
  return {
    name: 'fake',
    async grade(input: GradingProviderInput): Promise<GradingProviderOutput> {
      if (overrides.throws) throw overrides.throws;
      const response = overrides.response ?? defaultResponse(input.essayContent, input.wordCount);
      return {
        response,
        raw: JSON.stringify(response),
        promptTokensEstimate: 0,
        completionTokensEstimate: 0,
      };
    },
  };
}
