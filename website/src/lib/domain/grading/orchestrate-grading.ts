import 'server-only';

/**
 * KAN-16 — the grading worker itself: given a job id, does the actual
 * grading and persists the outcome. Called either directly (the inline
 * queue, local/test — see `queue.ts`) or via the internal HTTP processing
 * route (production, invoked by Cloud Tasks) — this function does not know
 * or care which; both paths hand it nothing but a job id.
 *
 * Idempotent by construction: a job already `succeeded`/`failed` is a no-op
 * on redelivery — ADR-2's "Cloud Tasks... has built-in retries" means this
 * function WILL be called more than once for the same job on a transient
 * delivery failure, and re-running a completed grading (a second provider
 * charge for the same essay) would be a real cost bug, not merely wasted
 * work. KAN-16 round-1 review, finding 5: this used to be true only for
 * TERMINAL states — the plain top-of-function status read below is an
 * optimisation to skip essay/word-count work for an obviously-finished job,
 * not the actual guard. The real guard is the atomic conditional claim right
 * before the provider is ever called (`markGradingJobProcessingUnscoped`,
 * `WHERE status = 'pending'`) — two concurrent deliveries of the same
 * `pending` job could otherwise both pass the plain read above, both call
 * the provider, and both bill for it.
 *
 * KAN-16 Note 1 (the ticket's own PO note on sequencing): re-checks the
 * 50-300 word ceiling itself, against the STORED essay content, before ever
 * calling a provider — independent of whatever `POST /api/essays` already
 * enforced at submission time. The ticket's own reasoning: "the ceiling
 * protects real money and should not depend on a client-side counter" (nor,
 * this adds, on a request-time check a completely different code path could
 * theoretically bypass later — Note 2's own "fragile inheritance" warning).
 * Should be unreachable in production today, since `createEssay` is the
 * ONLY production write path for essay content and it's always reached
 * through `essaySubmissionRequestSchema`'s own word-count refinement first —
 * this check is what keeps that true even if that invariant is ever
 * silently broken by a future essay-writing path this story has no way to
 * prevent someone adding.
 *
 * Every failure path below is logged through KAN-24's telemetry exactly
 * once — "no grading job is silently excluded" is that story's own
 * acceptance criterion, and every `return` in this function is preceded by
 * either a success or a failure telemetry call, with two narrow exceptions,
 * each documented at its own `return`: the job-row-already-gone guard right
 * at the top, and the KAN-16 round-1 review finding-13 retry path, where the
 * job isn't finished yet at all — it's reverted to `pending` for another
 * delivery to pick up, so nothing terminal has happened to log.
 */
import { countGermanWords, classifyEssayLength, isEssayLengthBlocked } from '@/lib/contracts/word-count';
import type { GradingFailureReason } from '@/lib/contracts/grading';
import type { GuestSessionId, SystemActor } from '@/lib/contracts/actor';
import { getEssayByIdUnscoped } from '@/lib/db/essays';
import {
  getGradingJobByIdUnscoped,
  markGradingJobFailedUnscoped,
  markGradingJobProcessingUnscoped,
  markGradingJobSucceededUnscoped,
  revertGradingJobToPendingUnscoped,
} from '@/lib/db/grading-jobs';
import { buildGradingPrompt } from './prompt';
import { createGradingProvider } from './provider-factory';
import { GradingProviderError } from './provider';
import { resolveAnnotationSpans } from './span-resolution';
import { buildGradingResult, clampForSuspectedInjection } from './result';
import { detectPromptInjection } from './injection-guard';
import { estimateCostUsd } from './cost';
import { logGradingJobTelemetry } from './telemetry';

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'grading-worker' };

/**
 * `providerGradingResponseSchema.parse` (called inside each `GradingProvider`
 * implementation) throws a plain Zod error on a shape failure, never a
 * `GradingProviderError` — see `mistral-provider.ts`'s own comment on why
 * that distinction is deliberate. This is the one place that turns either
 * failure kind into a stable `GradingFailureReason`, by `instanceof`/name
 * check, never by inspecting a message string (KAN-16's own ticket note:
 * follow KAN-31/KAN-15's "reason travels as data" shape).
 */
function classifyGradingError(err: unknown): GradingFailureReason {
  if (err instanceof GradingProviderError) return 'providerError';
  if (err instanceof Error && err.name === 'ZodError') return 'invalidProviderResponse';
  return 'unknown';
}

interface FailureOptions {
  readonly promptInjectionSuspected?: boolean;
  /**
   * `null` when genuinely not known (KAN-16 round-1 review, finding 12) —
   * `undefined` here defaults to `0`, which is only correct for the two
   * callers where no provider call was ever attempted at all
   * (`wordCountOutOfBounds`, `essayMissing`). The catch-all failure path
   * below passes `null` explicitly: an `invalidProviderResponse` means the
   * provider WAS called and DID bill for tokens, just with no usage figures
   * surfaced past the thrown error.
   */
  readonly tokenCountEstimate?: number | null;
  readonly costEstimateUsd?: number | null;
}

async function recordFailure(
  jobId: string,
  submissionId: string,
  sessionId: GuestSessionId | null,
  startedAtMs: number,
  errorType: GradingFailureReason,
  provider: string | null,
  options: FailureOptions = {},
): Promise<void> {
  await markGradingJobFailedUnscoped(SYSTEM_ACTOR, jobId, errorType, provider);
  logGradingJobTelemetry({
    submissionId,
    sessionId,
    provider,
    latencyMs: Date.now() - startedAtMs,
    success: false,
    errorType,
    spanValidationPassed: null,
    promptInjectionSuspected: options.promptInjectionSuspected ?? false,
    // `??` would coalesce an explicit `null` (finding 12's "genuinely
    // unknown") right back to the same `0` it's meant to be distinct from —
    // `??`/`||` only ever see "was this nullish", never "was this UNSET
    // versus explicitly null". Only a genuinely absent key defaults to `0`.
    tokenCountEstimate: 'tokenCountEstimate' in options ? options.tokenCountEstimate! : 0,
    costEstimateUsd: 'costEstimateUsd' in options ? options.costEstimateUsd! : 0,
  });
}

export interface RunGradingJobOptions {
  /**
   * KAN-16 round-1 review, finding 13: whether this is the last delivery
   * attempt this job gets. `true` (the default) preserves the original,
   * always-terminal behaviour for every existing caller — the inline queue
   * (`queue.ts`, local/dev/test) has no Cloud Tasks redelivery to hand a
   * transient failure off to, so treating every inline invocation as final
   * is correct, not a workaround. Only
   * `POST /api/internal/grading-jobs/process` (the real Cloud Tasks target)
   * ever passes `false`, derived from the `X-CloudTasks-TaskRetryCount`
   * header Cloud Tasks itself attaches on redelivery — see that route's own
   * comment for the retry budget this is paired with.
   */
  readonly isFinalAttempt?: boolean;
}

/**
 * `'retryable'` is what lets `POST /api/internal/grading-jobs/process`
 * decide whether to answer Cloud Tasks 503 (finding 13) WITHOUT that route
 * reaching back into `lib/db/grading-jobs` itself to re-read the job's
 * status — ADR-14's layering rule (adapters import `lib/domain`, never
 * `lib/db`) applies to that route exactly like every other one. Returning
 * the outcome directly is the domain-layer seam that keeps it true here.
 * `'noop'` covers every path that did no new work this call: the job row is
 * gone, it was already terminal, or a concurrent delivery won the atomic
 * claim first (finding 5).
 */
export type GradingJobOutcome = 'succeeded' | 'failed' | 'retryable' | 'noop';

export async function runGradingJob(jobId: string, options: RunGradingJobOptions = {}): Promise<GradingJobOutcome> {
  const isFinalAttempt = options.isFinalAttempt ?? true;

  const job = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, jobId);
  if (!job) {
    // The job row is gone — a right-to-erasure cascade or the retention
    // sweep deleted the essay (and, via the FK, this row) between enqueue
    // and delivery. Nothing left to grade and no `submissionId` left to
    // attach a telemetry line to that would mean anything — KAN-24's own
    // scope is jobs that ran, not ones erased out from under the queue
    // before they could.
    return 'noop';
  }
  if (job.status === 'succeeded' || job.status === 'failed') {
    // Cheap early exit for an obviously-finished job — see this file's own
    // top comment on why this plain read is an optimisation, not the actual
    // concurrency guard (that's the conditional claim below).
    return 'noop';
  }

  const submissionId = job.essayId;
  const startedAtMs = job.createdAt.getTime();

  const essay = await getEssayByIdUnscoped(SYSTEM_ACTOR, job.essayId);
  if (!essay) {
    await recordFailure(job.id, submissionId, null, startedAtMs, 'essayMissing', null);
    return 'failed';
  }

  // Computed exactly once, per KAN-16 Note 2 ("the word count is computed
  // and thrown away... one call on the stored content — do not persist a
  // column for it") — feeds both the re-check below and the prompt's own
  // "reported word count" hint. Never written to a column anywhere.
  const wordCount = countGermanWords(essay.content);
  if (isEssayLengthBlocked(classifyEssayLength(wordCount))) {
    await recordFailure(job.id, submissionId, essay.sessionId, startedAtMs, 'wordCountOutOfBounds', null);
    return 'failed';
  }

  // The atomic claim (KAN-16 round-1 review, finding 5): only the delivery
  // whose UPDATE actually matches a `pending` row gets to call the provider.
  // A concurrent delivery that loses this race gets `false` back and stops
  // here — the delivery that won already has, or will, record this job's
  // one terminal telemetry line, so nothing is logged for the loser.
  const claimed = await markGradingJobProcessingUnscoped(SYSTEM_ACTOR, job.id);
  if (!claimed) {
    return 'noop';
  }

  const injection = detectPromptInjection(essay.content);
  const provider = createGradingProvider();
  const prompt = buildGradingPrompt(essay.content, wordCount);

  try {
    const output = await provider.grade({ ...prompt, wordCount, essayContent: essay.content });
    const { annotations, allSpansValid } = resolveAnnotationSpans(output.response.annotations, essay.content);
    let result = buildGradingResult(output.response, annotations);
    if (injection.suspected) {
      result = clampForSuspectedInjection(result);
    }

    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: provider.name,
      rawInput: `${prompt.system}\n\n${prompt.userDataBlock}`,
      rawOutput: output.raw,
      result,
      promptInjectionSuspected: injection.suspected,
    });

    logGradingJobTelemetry({
      submissionId,
      sessionId: essay.sessionId,
      provider: provider.name,
      latencyMs: Date.now() - startedAtMs,
      success: true,
      errorType: null,
      spanValidationPassed: allSpansValid,
      promptInjectionSuspected: injection.suspected,
      tokenCountEstimate: output.promptTokensEstimate + output.completionTokensEstimate,
      costEstimateUsd: estimateCostUsd(provider.name, output.promptTokensEstimate, output.completionTokensEstimate),
    });
    return 'succeeded';
  } catch (err) {
    // Never re-thrown, never logged by message — `err` for a
    // `GradingProviderError` may embed a raw provider response body (see
    // that class's own callers), which must never reach a log line. Only
    // the classified, stable reason code below does.
    const errorType = classifyGradingError(err);

    // KAN-16 round-1 review, finding 13: a `providerError` (transient —
    // network failure, non-2xx, timeout) that hasn't exhausted its retry
    // budget is reverted to `pending`, NOT recorded as a terminal failure —
    // the next Cloud Tasks redelivery reclaims it via the same conditional
    // claim above. `invalidProviderResponse`/`unknown` are never retried
    // here regardless of `isFinalAttempt`: a malformed response is a shape
    // bug, not a transient condition another attempt is likely to fix.
    if (errorType === 'providerError' && !isFinalAttempt) {
      await revertGradingJobToPendingUnscoped(SYSTEM_ACTOR, job.id);
      return 'retryable';
    }

    await recordFailure(job.id, submissionId, essay.sessionId, startedAtMs, errorType, provider.name, {
      promptInjectionSuspected: injection.suspected,
      // Not known here: `GradingProvider.grade` throws before ever
      // returning usage figures on this path (see `FailureOptions`'s own
      // comment) — `null` ("unknown"), never `0` ("definitely zero"), since
      // `invalidProviderResponse` specifically means the provider WAS called
      // and DID bill for it.
      tokenCountEstimate: null,
      costEstimateUsd: null,
    });
    return 'failed';
  }
}
