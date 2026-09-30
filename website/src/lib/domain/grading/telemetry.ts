import 'server-only';

/**
 * KAN-24 — the one structured log line every grading job produces, success
 * or failure, no exceptions ("no grading job is silently excluded from this
 * operational record once shipped" — the ticket's own acceptance criterion).
 *
 * `console.log`/`console.warn` with a single JSON object, the same idiom
 * `lib/domain/rate-limit.ts`'s `logRefusal` already established in this
 * codebase for a structured line meant to be queried in Cloud Logging —
 * Cloud Run captures stdout/stderr as Cloud Logging entries automatically,
 * with `jsonPayload` fields queryable in Log Analytics/BigQuery, which is
 * exactly the "logged centrally... and queryable in aggregate" the
 * acceptance criteria ask for, with zero new infrastructure — the same
 * "already in use" store `rate-limit.ts`'s own refusal logging already
 * relies on. See `docs/kan-24-grading-telemetry.md` for the saved queries
 * this shape is designed to answer (last-N sample for BR-3.4, the
 * submission-to-preview latency distribution for BR-5.2).
 *
 * What this line NEVER carries, enforced by this interface's own shape (no
 * field wide enough to hold either): essay text, an account email, or a full
 * LLM response body. `submissionId` (the essay's id — a random UUID, not
 * personal data on its own) is the join key back to the Postgres persistence
 * ADR-5 requires (raw input/output, structured result) for the Phase 2
 * calibration dataset — this record is the metadata-only complement to that,
 * never a second copy of it. `sessionIdHash` is a one-way, truncated hash of
 * the guest session id (see `hashSessionId` below) — a correlation key
 * across log lines for the SAME guest, never the bearer credential itself;
 * the same asymmetry `lib/domain/rate-limit.ts`'s own `hashAndTruncate`
 * documents for a HIGH-entropy input applies here identically (128 bits of
 * session-id entropy, not the low-entropy IP address that function also
 * hashes and where the same construction is NOT one-way — see that
 * function's own comment for the full reasoning this borrows).
 */
import { createHash } from 'node:crypto';
import type { GradingFailureReason } from '@/lib/contracts/grading';
import type { GuestSessionId } from '@/lib/contracts/actor';

/**
 * A local duplicate of `lib/domain/rate-limit.ts`'s `hashAndTruncate`, not a
 * shared import — same reasoning `lib/db/rate-limit.ts`'s own
 * `hashBucketKeyForLog` gives for its own local duplicate: this module and
 * `rate-limit.ts` are siblings, and importing one into the other for a
 * six-line hash function would couple two otherwise-independent stories for
 * no real gain.
 */
function hashSessionId(sessionId: GuestSessionId | null): string | null {
  if (sessionId === null) return null;
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}

export interface GradingTelemetryEvent {
  readonly submissionId: string;
  /**
   * Null for the rare "essay row already gone" failure path (see `orchestrate-grading.ts`'s own comment — there is no session id left to attach), and, since
   * KAN-52, for every essay an ACCOUNT owns: `essays.session_id` is NULL there, so the line carries `submissionId` as its only join key and no identity hash
   * for a registered user's job. A `userIdHash` here would close that (see `essay-submission-telemetry.ts`); it is not part of this story.
   */
  readonly sessionId: GuestSessionId | null;
  readonly provider: string | null;
  /** Submission -> grading-complete, in milliseconds (BR-5.2's own metric). */
  readonly latencyMs: number;
  readonly success: boolean;
  readonly errorType: GradingFailureReason | null;
  /** Null when grading never reached the point of producing annotations to validate (e.g. the provider call itself failed). */
  readonly spanValidationPassed: boolean | null;
  readonly promptInjectionSuspected: boolean;
  /**
   * `null` means "not known", never coerced to `0` — KAN-16 round-1 review,
   * finding 12: `invalidProviderResponse` means the provider WAS called and
   * DID bill for prompt+completion tokens; the shape check that classifies
   * it that way only fires after `GradingProvider.grade` has already thrown,
   * with no token counts surfaced on the way out. Logging `0` there made the
   * aggregate spend query systematically undercount exactly the traffic most
   * likely to be hostile (a probe that reliably produces malformed
   * responses). `wordCountOutOfBounds`/`essayMissing` are genuinely zero —
   * no provider call was ever made — and still log `0`, not `null`.
   */
  readonly tokenCountEstimate: number | null;
  readonly costEstimateUsd: number | null;
}

export function logGradingJobTelemetry(event: GradingTelemetryEvent): void {
  console.log(
    JSON.stringify({
      severity: event.success ? 'INFO' : 'WARNING',
      event: 'grading_job_completed',
      timestamp: new Date().toISOString(),
      submissionId: event.submissionId,
      sessionIdHash: hashSessionId(event.sessionId),
      provider: event.provider,
      latencyMs: event.latencyMs,
      success: event.success,
      errorType: event.errorType,
      spanValidationPassed: event.spanValidationPassed,
      promptInjectionSuspected: event.promptInjectionSuspected,
      tokenCountEstimate: event.tokenCountEstimate,
      costEstimateUsd: event.costEstimateUsd,
    }),
  );
}
