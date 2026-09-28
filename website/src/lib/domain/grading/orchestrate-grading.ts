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
 * work.
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
 * either a success or a failure telemetry call, with one narrow exception
 * (the job-row-already-gone guard right at the top) documented at that
 * `return` itself.
 */
import { countGermanWords, classifyEssayLength, isEssayLengthBlocked } from '@/lib/contracts/word-count';
import type { GradingFailureReason } from '@/lib/contracts/grading';
import type { GuestSessionId, SystemActor } from '@/lib/contracts/actor';
import { getEssayByIdUnscoped } from '@/lib/db/essays';
import {
  getGradingJobByIdUnscoped,
  markGradingJobFailed,
  markGradingJobProcessing,
  markGradingJobSucceeded,
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

async function recordFailure(
  jobId: string,
  submissionId: string,
  sessionId: GuestSessionId | null,
  startedAtMs: number,
  errorType: GradingFailureReason,
  provider: string | null,
): Promise<void> {
  await markGradingJobFailed(SYSTEM_ACTOR, jobId, errorType, provider);
  logGradingJobTelemetry({
    submissionId,
    sessionId,
    provider,
    latencyMs: Date.now() - startedAtMs,
    success: false,
    errorType,
    spanValidationPassed: null,
    promptInjectionSuspected: false,
    tokenCountEstimate: 0,
    costEstimateUsd: 0,
  });
}

export async function runGradingJob(jobId: string): Promise<void> {
  const job = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, jobId);
  if (!job) {
    // The job row is gone — a right-to-erasure cascade or the retention
    // sweep deleted the essay (and, via the FK, this row) between enqueue
    // and delivery. Nothing left to grade and no `submissionId` left to
    // attach a telemetry line to that would mean anything — KAN-24's own
    // scope is jobs that ran, not ones erased out from under the queue
    // before they could.
    return;
  }
  if (job.status === 'succeeded' || job.status === 'failed') {
    // Idempotency guard — see this file's own top comment. Already recorded
    // (success or failure) the first time this job ran; recording it again
    // would double-count KAN-24's telemetry for one real submission.
    return;
  }

  const submissionId = job.essayId;
  const startedAtMs = job.createdAt.getTime();

  const essay = await getEssayByIdUnscoped(SYSTEM_ACTOR, job.essayId);
  if (!essay) {
    await recordFailure(job.id, submissionId, null, startedAtMs, 'essayMissing', null);
    return;
  }

  await markGradingJobProcessing(SYSTEM_ACTOR, job.id);

  // Computed exactly once, per KAN-16 Note 2 ("the word count is computed
  // and thrown away... one call on the stored content — do not persist a
  // column for it") — feeds both the re-check below and the prompt's own
  // "reported word count" hint. Never written to a column anywhere.
  const wordCount = countGermanWords(essay.content);
  if (isEssayLengthBlocked(classifyEssayLength(wordCount))) {
    await recordFailure(job.id, submissionId, essay.sessionId, startedAtMs, 'wordCountOutOfBounds', null);
    return;
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

    await markGradingJobSucceeded(SYSTEM_ACTOR, job.id, {
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
  } catch (err) {
    // Never re-thrown, never logged by message — `err` for a
    // `GradingProviderError` may embed a raw provider response body (see
    // that class's own callers), which must never reach a log line. Only
    // the classified, stable reason code below does.
    await recordFailure(job.id, submissionId, essay.sessionId, startedAtMs, classifyGradingError(err), provider.name);
  }
}
