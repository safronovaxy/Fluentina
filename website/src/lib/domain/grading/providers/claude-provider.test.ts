/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaudeGradingProvider } from './claude-provider';
import { createAnthropicApiClient, type ClaudeMessagesClient } from './claude-client';
import { buildGradingPrompt } from '../prompt';
import { estimateCostUsd } from '../cost';
import { GradingProviderError, type GradingProviderInput } from '../provider';
import { RUBRIC_DIMENSIONS } from '@/lib/contracts/grading';

const ESSAY = 'Mein Geheimtext über den Urlaub.';

function validCompletion(overrides: Record<string, unknown> = {}) {
  return {
    overallScore: 72,
    summary: 'Summary.',
    dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: 72, comment: 'c' })),
    annotations: [{ quote: 'Urlaub', dimension: 'grammarSyntax', severity: 'minor', message: 'm' }],
    ...overrides,
  };
}

interface MessageOptions {
  readonly text?: string | null;
  readonly stopReason?: string;
  readonly usage?: { input_tokens: number; output_tokens: number };
}

/** A Messages API response body, as the real SDK parses it — thinking block first, as Opus 5.5 always returns. */
function messageBody({ text = JSON.stringify(validCompletion()), stopReason = 'end_turn', usage = { input_tokens: 1700, output_tokens: 5200 } }: MessageOptions = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...(text === null ? [] : [{ type: 'text', text }])],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { ...usage, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  };
}

function httpResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function gradingInput(): GradingProviderInput {
  return { ...buildGradingPrompt(ESSAY, 5), wordCount: 5, essayContent: ESSAY };
}

type FetchSpy = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

/** The parsed JSON body of the Nth request the stubbed `fetch` received. */
function requestBody(fetchSpy: FetchSpy, call = 0): Record<string, any> {
  return JSON.parse(String(fetchSpy.mock.calls[call][1]?.body));
}

describe('createClaudeGradingProvider — KAN-44, run through the real @anthropic-ai/sdk against a stubbed fetch', () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response>) {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => impl());
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  describe('request shape — the API 400s if any of these drift', () => {
    it('sends the shared prompt split at the role boundary, to the Messages API, authenticated with the key read at call time', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));
      const input = gradingInput();

      await createClaudeGradingProvider().grade(input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('api.anthropic.com/v1/messages');
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
      const body = requestBody(fetchSpy);
      expect(body.model).toBe('claude-opus-5-5');
      expect(body.system).toBe(input.system);
      expect(body.messages).toEqual([{ role: 'user', content: input.userDataBlock }]);
    });

    it('sets no thinking, tool_choice, sampling or prefill parameters — thinking is always on and forced tool_choice / assistant prefill 400 on this model', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));

      await createClaudeGradingProvider().grade(gradingInput());

      const body = requestBody(fetchSpy);
      for (const key of ['thinking', 'tool_choice', 'tools', 'temperature', 'top_p', 'top_k', 'output_format']) {
        expect(body, `"${key}" must not be sent`).not.toHaveProperty(key);
      }
      expect(body.messages.at(-1).role).toBe('user');
    });

    it('sets effort explicitly and requests structured outputs under output_config.format, not the deprecated output_format', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));

      await createClaudeGradingProvider().grade(gradingInput());

      const { output_config } = requestBody(fetchSpy);
      expect(output_config.effort).toBe('medium');
      expect(output_config.format.type).toBe('json_schema');
      expect(output_config.format.schema.required).toEqual(['overallScore', 'dimensions', 'annotations', 'summary']);
    });

    // KAN-44 hazard 1. Mistral's 3000 is sized for a response with nothing in
    // front of it; here thinking is billed as output and counts against the
    // same ceiling, so 3000 can be spent before the JSON starts.
    it('sizes max_tokens for thinking plus the response, not Mistral\'s 3000', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));

      await createClaudeGradingProvider().grade(gradingInput());

      expect(requestBody(fetchSpy).max_tokens).toBeGreaterThanOrEqual(10_000);
    });

    it('attaches a request timeout signal', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));

      await createClaudeGradingProvider().grade(gradingInput());

      expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('successful response', () => {
    it('returns the schema-validated response, ignoring the thinking block, with the raw message and the API-reported usage', async () => {
      stubFetch(async () => httpResponse(messageBody({ usage: { input_tokens: 1700, output_tokens: 5200 } })));

      const output = await createClaudeGradingProvider().grade(gradingInput());

      expect(output.response.overallScore).toBe(72);
      expect(output.response.annotations).toHaveLength(1);
      expect(output.promptTokensEstimate).toBe(1700);
      // output_tokens already includes thinking — it is what is billed.
      expect(output.completionTokensEstimate).toBe(5200);
      expect(JSON.parse(output.raw).stop_reason).toBe('end_turn');
    });

    it('is named "claude", and that name has a real, non-zero rate in cost.ts — a missing entry would log $0 for every job', async () => {
      stubFetch(async () => httpResponse(messageBody({ usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })));
      const provider = createClaudeGradingProvider();

      const output = await provider.grade(gradingInput());

      expect(provider.name).toBe('claude');
      expect(estimateCostUsd(provider.name, output.promptTokensEstimate, output.completionTokensEstimate)).toBeCloseTo(24, 10);
    });
  });

  // KAN-44 hazard: the SDK retries connection errors, timeouts, 408/409/429
  // and 5xx twice by default. ADR-2 gives retries to the job level; a retry
  // in here would triple the calls (and the bill) for one failed attempt.
  describe('no retry inside the provider — one HTTP call per grade(), whatever fails', () => {
    it.each([429, 500, 529])('makes exactly one request and throws GradingProviderError on a %i', async (status) => {
      const fetchSpy = stubFetch(async () => httpResponse({ type: 'error', error: { type: 'api_error', message: `echo ${ESSAY}` } }, status));

      const failure = createClaudeGradingProvider().grade(gradingInput());

      await expect(failure).rejects.toBeInstanceOf(GradingProviderError);
      await failure.catch((err: GradingProviderError) => expect(err.message).toBe(`Claude responded ${status}`));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('makes exactly one request on a network failure, and throws GradingProviderError', async () => {
      const fetchSpy = stubFetch(async () => {
        throw new TypeError('fetch failed');
      });

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('makes exactly one request when the timeout fires, and throws GradingProviderError', async () => {
      const fetchSpy = stubFetch(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      });

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('asks whichever client it is given for zero retries and a timeout — so a Vertex client swapped in later inherits both', async () => {
      const create = vi.fn().mockResolvedValue(messageBody());
      const injected = { messages: { create } } as unknown as ClaudeMessagesClient;

      await createClaudeGradingProvider(() => injected).grade(gradingInput());

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][1]).toEqual({ timeout: expect.any(Number), maxRetries: 0 });
      expect(create.mock.calls[0][1].timeout).toBeGreaterThan(0);
    });
  });

  describe('failure classification — what orchestrate-grading.ts switches on', () => {
    it('a schema-violating response is a plain ZodError, not a GradingProviderError (-> invalidProviderResponse, never retried)', async () => {
      stubFetch(async () => httpResponse(messageBody({ text: JSON.stringify(validCompletion({ overallScore: 250 })) })));

      const failure = createClaudeGradingProvider().grade(gradingInput());

      await expect(failure).rejects.toMatchObject({ name: 'ZodError' });
      await failure.catch((err) => expect(err).not.toBeInstanceOf(GradingProviderError));
    });

    it('a response missing a rubric dimension is rejected by the schema', async () => {
      const dimensions = RUBRIC_DIMENSIONS.slice(1).map((dimension) => ({ dimension, score: 50, comment: 'c' }));
      stubFetch(async () => httpResponse(messageBody({ text: JSON.stringify(validCompletion({ dimensions })) })));

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toMatchObject({ name: 'ZodError' });
    });

    // Hazard 1's failure mode: thinking eats the ceiling, the JSON is cut
    // off. Must be a clean, non-retried failure rather than a JSON.parse
    // crash on half a document — and never parsed at all.
    it('a response cut off at max_tokens is an invalidProviderResponse-class ZodError naming the stop reason, not a parse error', async () => {
      const fetchSpy = stubFetch(async () => httpResponse(messageBody({ text: '{"overallScore": 72, "summ', stopReason: 'max_tokens' })));

      const failure = createClaudeGradingProvider().grade(gradingInput());

      await expect(failure).rejects.toMatchObject({ name: 'ZodError' });
      await failure.catch((err) => {
        expect(err).not.toBeInstanceOf(GradingProviderError);
        expect(err.message).toContain('max_tokens');
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('a refusal is treated the same way — its text is not schema-shaped and redelivery will not change it', async () => {
      stubFetch(async () => httpResponse(messageBody({ text: 'I cannot help with that.', stopReason: 'refusal' })));

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toMatchObject({ name: 'ZodError' });
    });

    it('a response with no text block is a GradingProviderError', async () => {
      stubFetch(async () => httpResponse(messageBody({ text: null })));

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
    });

    it('a text block that is not JSON is a GradingProviderError', async () => {
      stubFetch(async () => httpResponse(messageBody({ text: 'not json' })));

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
    });
  });

  describe('credential handling', () => {
    it('constructing the provider and the client factory with no ANTHROPIC_API_KEY does not throw — only grade() needs it', () => {
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => createClaudeGradingProvider()).not.toThrow();
    });

    it('grade() with no key throws GradingProviderError before any request is made', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));

      await expect(createClaudeGradingProvider().grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('createAnthropicApiClient reads the key when called, not at import', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createAnthropicApiClient()).toThrow(GradingProviderError);
      process.env.ANTHROPIC_API_KEY = 'later-key';
      expect(() => createAnthropicApiClient()).not.toThrow();
    });
  });

  describe('client isolation — the Vertex seam', () => {
    it('grades through an injected client without touching the API-key client or the network', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const fetchSpy = stubFetch(async () => httpResponse(messageBody()));
      const create = vi.fn().mockResolvedValue(messageBody());
      const injected = { messages: { create } } as unknown as ClaudeMessagesClient;

      const output = await createClaudeGradingProvider(() => injected).grade(gradingInput());

      expect(output.response.overallScore).toBe(72);
      expect(create).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('wraps a failure constructing an injected client (e.g. Vertex auth) as a GradingProviderError', async () => {
      const provider = createClaudeGradingProvider(() => {
        throw new Error('could not load application default credentials');
      });

      await expect(provider.grade(gradingInput())).rejects.toBeInstanceOf(GradingProviderError);
    });
  });

  describe('metadata only — nothing that can carry essay text or the key', () => {
    it('no thrown message contains the essay or the API key, whichever path failed', async () => {
      const failures: Array<() => Promise<Response>> = [
        async () => httpResponse({ type: 'error', error: { type: 'invalid_request_error', message: `bad: ${ESSAY} test-key` } }, 400),
        async () => {
          throw new TypeError(`fetch failed for ${ESSAY}`);
        },
        async () => httpResponse(messageBody({ text: `not json ${ESSAY}` })),
        async () => httpResponse(messageBody({ text: ESSAY, stopReason: 'refusal' })),
      ];
      for (const impl of failures) {
        stubFetch(impl);
        const err = await createClaudeGradingProvider().grade(gradingInput()).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain('Geheimtext');
        expect((err as Error).message).not.toContain('test-key');
      }
    });
  });
});
