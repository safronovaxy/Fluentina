/**
 * KAN-16 — the persisted shape of a grading job, and the public (guest-
 * facing) view of it that `GET /api/essays/[id]/grading` returns.
 *
 * Deliberately two shapes:
 *
 * - `GradingJob` here is the PUBLIC view — safe to serialise straight into
 *   an HTTP response. It carries the structured `GradingResult` once
 *   succeeded, but never the raw prompt or raw provider response body.
 * - The raw input/output ADR-5 requires persisting (for a future
 *   fine-tuning dataset) lives only in `lib/db/grading-jobs.ts`'s own
 *   internal row type, which nothing outside `lib/db`/`lib/domain` ever
 *   sees — see that module's own comment.
 */
import type { GradingFailureReason, GradingResult } from './grading';

export const GRADING_JOB_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;
export type GradingJobStatus = (typeof GRADING_JOB_STATUSES)[number];

export interface GradingJob {
  readonly id: string;
  readonly essayId: string;
  readonly status: GradingJobStatus;
  /** Which `GradingProvider` handled this job — null until the job actually starts calling one. */
  readonly provider: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  /** Present only once `status === 'succeeded'`. */
  readonly result: GradingResult | null;
  /** Present only once `status === 'failed'`. */
  readonly failureReason: GradingFailureReason | null;
}
