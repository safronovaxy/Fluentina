/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMistralGradingProvider } from './mistral-provider';
import { buildGradingPrompt } from '../prompt';
import { GradingProviderError } from '../provider';
import { RUBRIC_DIMENSIONS } from '@/lib/contracts/grading';

function validCompletionJson() {
  return JSON.stringify({
    overallScore: 72,
    summary: 'Summary.',
    dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: 72, comment: 'c' })),
    annotations: [],
  });
}

function mistralHttpResponse(completionText: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: completionText } }],
      usage,
    }),
    { status: 200 },
  );
}

describe('createMistralGradingProvider — ADR-4', () => {
  const previousKey = process.env.MISTRAL_API_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previousKey;
    vi.unstubAllGlobals();
  });

  it('never calls Mistral or Claude directly from feature code — this file is the ONLY place fetch touches the Mistral API, and it sends the system/user split the shared prompt built', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue(mistralHttpResponse(validCompletionJson(), { prompt_tokens: 100, completion_tokens: 50 }));
    vi.stubGlobal('fetch', fetchSpy);

    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('Ein Aufsatz.', 2);
    const output = await provider.grade({ ...prompt, wordCount: 2, essayContent: 'Ein Aufsatz.' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('mistral.ai');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: prompt.system });
    expect(body.messages[1]).toEqual({ role: 'user', content: prompt.userDataBlock });
    expect(body.response_format).toEqual({ type: 'json_object' });

    expect(output.response.overallScore).toBe(72);
    expect(output.promptTokensEstimate).toBe(100);
    expect(output.completionTokensEstimate).toBe(50);
  });

  // KAN-16 round-1 review, finding 4: neither of these was set at all. A
  // 300-word essay asking for exhaustive per-word annotations could produce
  // an unbounded, fully-billed completion before the response schema ever
  // got a chance to reject it, and a hung connection had nothing to cut it
  // off before Cloud Run's own request timeout.
  it('bounds completion length with max_tokens and attaches a request timeout, finding 4', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue(mistralHttpResponse(validCompletionJson()));
    vi.stubGlobal('fetch', fetchSpy);

    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);
    await provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws GradingProviderError, never MISTRAL_API_KEY, when the request times out', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    await expect(provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' })).rejects.toBeInstanceOf(GradingProviderError);
  });

  it('throws GradingProviderError, never MISTRAL_API_KEY, when the key is not configured', async () => {
    delete process.env.MISTRAL_API_KEY;
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    await expect(provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' })).rejects.toBeInstanceOf(GradingProviderError);
  });

  it('throws GradingProviderError on a non-2xx response, carrying no essay content in the message', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('Mein Geheimtext', 2);

    const failure = provider.grade({ ...prompt, wordCount: 2, essayContent: 'Mein Geheimtext' });
    await expect(failure).rejects.toBeInstanceOf(GradingProviderError);
    await failure.catch((err: GradingProviderError) => {
      expect(err.message).not.toContain('Mein Geheimtext');
    });
  });

  it('throws GradingProviderError on a network failure', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    await expect(provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' })).rejects.toBeInstanceOf(GradingProviderError);
  });

  it('throws GradingProviderError when the completion has no content', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    await expect(provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' })).rejects.toBeInstanceOf(GradingProviderError);
  });

  it('propagates a plain (non-GradingProviderError) schema failure when the completion JSON does not match the required shape', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mistralHttpResponse(JSON.stringify({ nope: true }))));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    const failure = provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' });
    await expect(failure).rejects.not.toBeInstanceOf(GradingProviderError);
  });

  it('falls back to a character-based token estimate when the API response carries no usage field', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mistralHttpResponse(validCompletionJson())));
    const provider = createMistralGradingProvider();
    const prompt = buildGradingPrompt('essay', 1);

    const output = await provider.grade({ ...prompt, wordCount: 1, essayContent: 'essay' });

    expect(output.promptTokensEstimate).toBeGreaterThan(0);
    expect(output.completionTokensEstimate).toBeGreaterThan(0);
  });
});
