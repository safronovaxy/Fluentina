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
 * No retry logic here: ADR-2 gives the CALLER retries at the JOB level, not
 * this file — retrying inside a single provider call too would double up on
 * that and risk two provider charges for one guest submission. A transient
 * failure here surfaces as a `GradingProviderError`. What actually happens
 * to it next is `orchestrate-grading.ts`'s own call, not this file's: per
 * KAN-16 round-1 review, finding 13, a `GradingProviderError` classified as
 * `providerError` is retried — reverted to `pending` for Cloud Tasks to
 * redeliver, up to a capped number of attempts
 * (`POST /api/internal/grading-jobs/process`'s own
 * `MAX_PROVIDER_RETRY_ATTEMPTS`) — and only recorded `failed` once that
 * budget is exhausted, or immediately for any other failure classification.
 * See that route's own top comment for the full contract; this file only
 * needs to classify the failure correctly, never to retry it itself.
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
 * KAN-16 round-1 review, finding 4: the request used to set neither of
 * these, so completion length was unbounded and driven by guest-controlled
 * text — a 300-word essay asking for exhaustive per-word annotations could
 * produce a ~32k-token completion, billed in full, before
 * `providerGradingResponseSchema` ever got a chance to reject it for
 * exceeding `MAX_ANNOTATIONS`/`MAX_QUOTE_CHARS`. 3000 tokens is comfortably
 * above any valid response this schema accepts (four dimension comments plus
 * a bounded annotation list) and far below a runaway one — sized correctly,
 * a worst-case essay costs about $0.005 instead of about $0.19.
 */
const MAX_COMPLETION_TOKENS = 3000;

/**
 * Bounds how long a single Mistral call is allowed to hang before this
 * provider gives up — without it, a stalled connection held the job open
 * until Cloud Run's own request timeout, blowing BR-5.2's 60-second budget
 * and risking a Cloud Tasks redelivery re-billing the same essay on top of
 * whatever the hung request eventually did. Comfortably under Cloud Run's
 * own request timeout so THIS throws first, with a classifiable error,
 * rather than the platform cutting the connection with none.
 */
const REQUEST_TIMEOUT_MS = 45_000;

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
            max_tokens: MAX_COMPLETION_TOKENS,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.userDataBlock },
            ],
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // Network-level failure (DNS, TLS, connection reset) OR the
        // `AbortSignal.timeout` above firing (a `TimeoutError`/`AbortError`,
        // per the WHATWG fetch spec `fetch` rejects with on abort) — both
        // are transient, both classify as `providerError` in
        // `orchestrate-grading.ts` exactly the same way. Never the essay
        // content or the API key in the thrown message.
        throw new GradingProviderError('Mistral request failed (network error or timeout)', err);
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
