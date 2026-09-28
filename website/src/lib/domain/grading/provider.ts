import 'server-only';

/**
 * KAN-16 / ADR-5 — the `GradingProvider` seam every grading call goes
 * through. "Grading goes through the `GradingProvider` abstraction. Never
 * call Mistral or Claude directly from feature code" (the story's own
 * non-negotiable) means exactly this: `orchestrate-grading.ts` calls
 * `GradingProvider.grade`, never `fetch`ing a provider's API directly, and
 * `provider-factory.ts` is the only place that decides WHICH implementation
 * backs that call.
 *
 * `grade` takes already-built prompt parts (`lib/domain/grading/prompt.ts`),
 * not raw essay content — the BR-3.5 delimiting/defence instruction lives in
 * exactly one place (`prompt.ts`) and every implementation sends it
 * verbatim, rather than each provider file re-deriving its own version of
 * "treat this as data" and risking the two drifting apart.
 *
 * `raw` in the return value is the provider's raw response body, kept as a
 * plain string — this is what ADR-5's "persistence of each grading job's raw
 * input/output alongside the structured result" persists into
 * `grading_jobs.raw_output` (see `lib/db/grading-jobs.ts`), so a future
 * fine-tuning dataset doesn't have to be reconstructed retroactively from a
 * structured result that already dropped information (e.g. the model's exact
 * wording before span resolution discarded unresolvable annotations).
 */
import type { ProviderGradingResponse } from '@/lib/contracts/grading';
import type { GradingPrompt } from './prompt';

export interface GradingProviderInput extends GradingPrompt {
  readonly wordCount: number;
  /**
   * The guest's raw, un-delimited essay text — included alongside `system`/
   * `userDataBlock` (which already embed it, wrapped) so a fake/test
   * provider can build a verbatim `quote` without re-parsing the delimiter
   * markers back out of `userDataBlock`. A real provider implementation
   * (Mistral, and later Claude) never reads this field: it only ever sends
   * `system` and `userDataBlock` over the wire, exactly as `prompt.ts`
   * built them.
   */
  readonly essayContent: string;
}

export interface GradingProviderOutput {
  readonly response: ProviderGradingResponse;
  /** The raw response body/text, exactly as the provider returned it — see this module's own comment. */
  readonly raw: string;
  /** Rough estimate only — see `estimateCostUsd` (`cost.ts`) for why this is never billing-accurate. */
  readonly promptTokensEstimate: number;
  readonly completionTokensEstimate: number;
}

export interface GradingProvider {
  /** `'mistral'` / `'fake'` today; `'claude'` once ADR-4's fallback is built. Persisted verbatim as `grading_jobs.provider` and logged in KAN-24's telemetry. */
  readonly name: string;
  grade(input: GradingProviderInput): Promise<GradingProviderOutput>;
}

/**
 * Thrown by a `GradingProvider` implementation for anything that isn't a
 * schema-validation failure (which the implementation itself should raise as
 * a plain `Error` after `providerGradingResponseSchema.parse` throws) —
 * network failure, non-2xx response, missing API key. Kept as its own class
 * so `orchestrate-grading.ts` can classify a failure into a
 * `GradingFailureReason` without string-matching a message (KAN-16's own
 * ticket note: follow KAN-31/KAN-15's "reason travels as data" shape).
 */
export class GradingProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GradingProviderError';
  }
}
