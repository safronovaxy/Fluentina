import 'server-only';

/**
 * KAN-44 / ADR-4 (amended) — Claude as the Phase 1 primary grading
 * provider; Mistral (`mistral-provider.ts`) stays working as the deferred
 * second step. Built on the official `@anthropic-ai/sdk`, unlike Mistral's
 * plain-`fetch` call: a deliberate, per-provider divergence from ADR-4's
 * "no SDK" framing, which is safe because `GradingProvider` is the seam —
 * nothing outside this file and `claude-client.ts` knows an SDK is involved.
 *
 * Client construction lives in `claude-client.ts` and is injected here, so
 * moving to Vertex AI (EU data residency) is a constructor swap. The
 * credential is read when `grade()` builds its client, never at import — see
 * that file for why importing must not throw.
 *
 * No retry logic here, and that includes the SDK's own: `@anthropic-ai/sdk`
 * retries connection errors, timeouts, 408/409/429 and 5xx twice BY DEFAULT.
 * ADR-2 gives retries to the job level (`orchestrate-grading.ts` reverts a
 * `providerError` to `pending`, up to `MAX_PROVIDER_RETRY_ATTEMPTS`
 * deliveries), so leaving the default on would multiply every failure by
 * three inside one attempt and bill each try — `maxRetries: 0` below is what
 * prevents that. It is a REQUEST option, not a client-constructor one, so it
 * holds for whichever client is injected.
 *
 * Failure classification follows `orchestrate-grading.ts`'s contract, and
 * this file only classifies, never retries:
 * - transport/HTTP failure, missing credential, or a completion that isn't
 *   JSON or has no text: `GradingProviderError` -> `providerError`
 *   (retried at job level).
 * - a response that finished but doesn't satisfy `providerGradingResponseSchema`
 *   (plain `ZodError`) -> `invalidProviderResponse` (never retried).
 * - a response that did NOT finish (`stop_reason` other than `end_turn`:
 *   `max_tokens`, `refusal`, ...) -> also a `ZodError`, deliberately. Retrying
 *   a truncation would re-bill a ceiling-sized completion to reach the same
 *   place, and a refusal won't change on redelivery; the orchestrator's own
 *   comment says a malformed response "is a shape bug, not a transient
 *   condition". A dedicated error class would say this more directly but
 *   needs an orchestrator change, which this story does not make.
 */
import { z } from 'zod';
import { providerGradingResponseSchema } from '@/lib/contracts/grading';
import { GradingProviderError, type GradingProvider, type GradingProviderInput, type GradingProviderOutput } from '../provider';
import { createAnthropicApiClient, type ClaudeClientFactory } from './claude-client';
import { gradingOutputFormat } from './claude-output-format';

/**
 * The Claude API ID for Claude Opus 5.5, the model the models overview
 * recommends starting with for most workloads. Google Cloud uses the same ID,
 * so this survives the Vertex swap unchanged. Not tuned against real grading
 * quality — that is ADR-4's still-outstanding side-by-side spike — and
 * `cost.ts`'s `claude` rates are THIS model's: change both together.
 */
const CLAUDE_MODEL = 'claude-opus-5-5';

/**
 * Set explicitly rather than inherited. On Opus 5.5 `medium` is the API
 * default, so this changes nothing today — it pins spend against a future
 * default change. Thinking can't be turned off on this model (`thinking:
 * {type: 'disabled'}` and `budget_tokens` both 400), so effort is the only
 * lever on how much of `MAX_OUTPUT_TOKENS` reasoning consumes before the
 * rubric JSON starts.
 */
const CLAUDE_EFFORT = 'medium';

/**
 * A hard ceiling on thinking PLUS the JSON response — thinking is billed as
 * output and counts against `max_tokens` even when its text isn't returned.
 * This is deliberately not `mistral-provider.ts`'s 3000: that fits a
 * response with no reasoning in front of it, and here a tight ceiling can be
 * spent on thinking before the JSON begins, surfacing as a truncated
 * completion. A valid response is a few thousand tokens (four comments, up
 * to 60 annotations, a summary); 16k leaves room for `medium`-effort
 * reasoning on top. Unmeasured — the ADR-4 spike should record real
 * thinking/response token counts and tune this. Every token of it is billable:
 * see `cost.ts` and the worst-case figure in this story's handover.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Same budget-derived bound as `mistral-provider.ts` (BR-5.2's 60 seconds,
 * with headroom, and under Cloud Run's own request timeout). NOT validated
 * against Opus 5.5 latency: a completion that uses much of
 * `MAX_OUTPUT_TOKENS` may not finish in 45s, in which case it times out and
 * is retried at job level. Measure it in the ADR-4 spike before launch.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/** A `ZodError`, so `orchestrate-grading.ts`'s `err.name === 'ZodError'` check classifies it `invalidProviderResponse` — see this file's top comment. */
function incompleteResponseError(stopReason: string | null): z.ZodError {
  return new z.ZodError([
    { code: z.ZodIssueCode.custom, path: [], message: `Claude response did not complete (stop_reason: ${stopReason ?? 'none'})` },
  ]);
}

/** Status only — never `err.message`, which for an `APIError` embeds the response body. */
function describeRequestFailure(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? `Claude responded ${status}` : 'Claude request failed (network error or timeout)';
}

export function createClaudeGradingProvider(createClient: ClaudeClientFactory = createAnthropicApiClient): GradingProvider {
  return {
    name: 'claude',
    async grade(input: GradingProviderInput): Promise<GradingProviderOutput> {
      let client: ReturnType<ClaudeClientFactory>;
      try {
        client = createClient();
      } catch (err) {
        if (err instanceof GradingProviderError) throw err;
        throw new GradingProviderError('Claude client could not be constructed', err);
      }

      let message: Awaited<ReturnType<typeof client.messages.create>>;
      try {
        message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            // No `thinking` field (always on, and `disabled`/`budget_tokens`
            // 400 on this model), no `tool_choice` (forced choice 400s), and
            // the last message is a user turn (an assistant prefill 400s).
            output_config: { effort: CLAUDE_EFFORT, format: gradingOutputFormat() },
            system: input.system,
            messages: [{ role: 'user', content: input.userDataBlock }],
          },
          { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
        );
      } catch (err) {
        // Transport failure, the timeout above firing, or a non-2xx: all
        // `providerError`. Never the essay or the API key in the message.
        throw new GradingProviderError(describeRequestFailure(err), err);
      }

      if (message.stop_reason !== 'end_turn') {
        throw incompleteResponseError(message.stop_reason);
      }

      // Thinking blocks come first and are not the answer; select by type.
      const completionText = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (!completionText) {
        throw new GradingProviderError('Claude response carried no text content');
      }

      let completionJson: unknown;
      try {
        completionJson = JSON.parse(completionText);
      } catch (err) {
        throw new GradingProviderError('Claude completion content was not valid JSON', err);
      }

      // A plain `ZodError`, on purpose — see this file's top comment. The API
      // enforces the wire schema, but not the constraints stripped from it
      // (`claude-output-format.ts`), and this is the single place that does.
      const response = providerGradingResponseSchema.parse(completionJson);

      return {
        response,
        // The whole message, thinking blocks and usage included: ADR-5 keeps
        // the provider's raw output alongside the structured result.
        raw: JSON.stringify(message),
        promptTokensEstimate: message.usage.input_tokens,
        // `output_tokens` is the inclusive, billing-authoritative figure —
        // it already counts thinking.
        completionTokensEstimate: message.usage.output_tokens,
      };
    },
  };
}
