/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { createFakeGradingProvider } from './fake-provider';
import { buildGradingPrompt } from '../prompt';
import { providerGradingResponseSchema } from '@/lib/contracts/grading';
import { resolveAnnotationSpans } from '../span-resolution';

describe('createFakeGradingProvider — zero network calls, deterministic', () => {
  it('always returns a schema-valid response for the default (no overrides) case', async () => {
    const essay = 'Wort0 Wort1 Wort2 Wort3 Wort4';
    const provider = createFakeGradingProvider();
    const prompt = buildGradingPrompt(essay, 5);

    const output = await provider.grade({ ...prompt, wordCount: 5, essayContent: essay });

    expect(providerGradingResponseSchema.safeParse(output.response).success).toBe(true);
    expect(provider.name).toBe('fake');
  });

  it('is deterministic for the same word count — same score every call', async () => {
    const provider = createFakeGradingProvider();
    const essayA = 'Wort0 Wort1 Wort2';
    const essayB = 'Anders0 Anders1 Anders2'; // different content, same word count
    const prompt = buildGradingPrompt(essayA, 3);

    const outputA = await provider.grade({ ...prompt, wordCount: 3, essayContent: essayA });
    const outputB = await provider.grade({ ...prompt, wordCount: 3, essayContent: essayB });

    expect(outputA.response.overallScore).toBe(outputB.response.overallScore);
  });

  it('every default annotation quote resolves against the real essay content — span resolution never drops it', async () => {
    const essay = 'Homeoffice bietet viele Vorteile für Angestellte heutzutage.';
    const provider = createFakeGradingProvider();
    const prompt = buildGradingPrompt(essay, 6);

    const output = await provider.grade({ ...prompt, wordCount: 6, essayContent: essay });
    const { allSpansValid } = resolveAnnotationSpans(output.response.annotations, essay);

    expect(allSpansValid).toBe(true);
  });

  it('overrides.response is returned verbatim, bypassing the deterministic default', async () => {
    const custom = {
      overallScore: 12,
      summary: 'Custom.',
      dimensions: [
        { dimension: 'textStructureCohesion' as const, score: 12, comment: 'c' },
        { dimension: 'vocabularyLexicalDensity' as const, score: 12, comment: 'c' },
        { dimension: 'grammarSyntax' as const, score: 12, comment: 'c' },
        { dimension: 'topicRelevanceContentCoverage' as const, score: 12, comment: 'c' },
      ],
      annotations: [],
    };
    const provider = createFakeGradingProvider({ response: custom });
    const prompt = buildGradingPrompt('essay', 1);

    const output = await provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' });

    expect(output.response.overallScore).toBe(12);
  });

  it('overrides.throws makes grade() reject, for testing the provider-failure path', async () => {
    const provider = createFakeGradingProvider({ throws: new Error('boom') });
    const prompt = buildGradingPrompt('essay', 1);

    await expect(provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' })).rejects.toThrow('boom');
  });
});
