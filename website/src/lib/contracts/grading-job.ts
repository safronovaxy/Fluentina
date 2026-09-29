/**
 * KAN-16 — the public (guest-facing) view of a grading job, which is what
 * `GET /api/essays/[id]/grading` returns.
 *
 * `GradingJob` here is the WIRE shape and only that — safe to serialise
 * straight into an HTTP response, because everything a caller may know about
 * a finished grade sits in `report` (`./grading-report`), already reduced to
 * what THAT caller is entitled to. It carries none of the raw prompt or raw
 * provider response body (ADR-5's fine-tuning persistence lives only in
 * `lib/db/grading-jobs.ts`'s own internal record), and — since KAN-19 — none
 * of the job's identifiers or which provider handled it: the browser never
 * used them, and the provider name only tells someone probing BR-3.5's
 * injection guard which model to write a payload for.
 *
 * `report` replaced `result` (KAN-19) deliberately, not cosmetically: a
 * client that was not updated fails at the poll hook's "succeeded with no
 * report is not a grade we can show" check instead of rendering a blank
 * score from a shape it no longer understands.
 *
 * Nothing in `lib/db` produces this shape. The only producer is
 * `getGradingStatus` in `lib/domain/grading/`, which cannot be called
 * without an `OwnerActor`.
 */
import type { GradingFailureReason } from './grading';
import type { GradingReportView } from './grading-report';

export const GRADING_JOB_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;
export type GradingJobStatus = (typeof GRADING_JOB_STATUSES)[number];

export interface GradingJob {
  readonly status: GradingJobStatus;
  readonly createdAt: Date;
  /** Present only once `status === 'failed'`. */
  readonly failureReason: GradingFailureReason | null;
  /** Present only once `status === 'succeeded'`. */
  readonly report: GradingReportView | null;
}
