import 'server-only';

/**
 * KAN-16 / ADR-4 — Mistral AI ("La Plateforme") as the primary grading
 * provider. A plain REST call with one secret, per the ADR's own framing:
 * no SDK dependency, `fetch` against the Chat Completions endpoint, JSON
 * mode requested so the response is parseable without scraping markdown
 * fences out of prose.
 *
 * `MISTRAL_API_KEY` is read from the environment (never committed — see
 * `.env.example`) and only at call time, not at module load: importing this
 * file (which `provider-factory.ts` does unconditionally, so its own
 * `MOCK_GRADING_PROVIDER` branch can be a plain if/else rather than a
 * dynamic import) must not throw in an environment that has the fake
 * provider selected and no Mistral key configured at all — e.g. every local
 * dev machine and this repo's own CI. Only `grade()` — reached exclusively
 * when this provider is actually selected and invoked — checks for the key.
 *
 * No retry logic here: ADR-2 gives the CALLER (Cloud Tasks, via the internal
 * processing endpoint) built-in retries at the JOB level; retrying inside a
 * single provider call as well would double up on that and risk two
 * provider charges for one guest submission. A transient failure here
 * surfaces as a `GradingProviderError`, which `orchestrate-grading.ts` marks
 * the job `failed` with — Cloud Tasks redelivering the task is what
 * actually retries the grading attempt, not this file.
 */
import { providerGradingResponseSchema } from '@/lib/contracts/grading';
import { GradingProviderError, type GradingProvider, type GradingProviderInput, type GradingProviderOutput } from '../provider';

const MISTRAL_CHAT_COMPLETIONS_URL = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Not tuned against real grading quality yet — that is the "short
 * side-by-side spike against the 15-20 Appendix A prompts" ADR-4 itself
 * names as still outstanding. A named constant so that spike changes one
 * line, not a literal buried in a request body.
 */
const MISTRAL_MODEL = 'mistral-large-latest';

/**
 * A rough, provider-published chars-per-token ratio for estimating token
 * counts from string lengths when the API response doesn't hand back exact
 * usage — see `estimateTokensFromText`'s own comment. Only used as a
 * fallback; `usage.prompt_tokens`/`usage.completion_tokens` from the API
 * response are preferred whenever present.
 */
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

interface MistralChatCompletionResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export function createMistralGradingProvider(): GradingProvider {
  return {
    name: 'mistral',
    async grade(input: GradingProviderInput): Promise<GradingProviderOutput> {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) {
        throw new GradingProviderError('MISTRAL_API_KEY is not set — see website/.env.example');
      }

      let httpResponse: Response;
      try {
        httpResponse = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MISTRAL_MODEL,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.userDataBlock },
            ],
          }),
        });
      } catch (err) {
        // Network-level failure (DNS, TLS, connection reset) — never the
        // essay content or the API key in the thrown message.
        throw new GradingProviderError('Mistral request failed (network error)', err);
      }

      const rawBody = await httpResponse.text();
      if (!httpResponse.ok) {
        // The response body from a 4xx/5xx is an ERROR payload from Mistral,
        // not essay content or a completion — safe to keep for diagnosis,
        // but never logged (see `orchestrate-grading.ts`'s own telemetry
        // comment) and not the guest's own text.
        throw new GradingProviderError(`Mistral responded ${httpResponse.status}`, rawBody);
      }

      let parsedBody: MistralChatCompletionResponse;
      try {
        parsedBody = JSON.parse(rawBody) as MistralChatCompletionResponse;
      } catch (err) {
        throw new GradingProviderError('Mistral response was not valid JSON', err);
      }

      const completionText = parsedBody.choices?.[0]?.message?.content;
      if (!completionText) {
        throw new GradingProviderError('Mistral response carried no completion content');
      }

      let completionJson: unknown;
      try {
        completionJson = JSON.parse(completionText);
      } catch (err) {
        throw new GradingProviderError('Mistral completion content was not valid JSON', err);
      }

      // Intentionally NOT a GradingProviderError: an invalid completion
      // SHAPE (as opposed to a transport/parse failure above) is
      // `invalidProviderResponse` in `orchestrate-grading.ts`'s
      // classification, a distinct, stable reason from `providerError` —
      // letting the plain ZodError propagate here is what that
      // classification switches on.
      const response = providerGradingResponseSchema.parse(completionJson);

      const promptTokensEstimate = parsedBody.usage?.prompt_tokens ?? estimateTokensFromText(input.system + input.userDataBlock);
      const completionTokensEstimate = parsedBody.usage?.completion_tokens ?? estimateTokensFromText(completionText);

      return { response, raw: rawBody, promptTokensEstimate, completionTokensEstimate };
    },
  };
}
