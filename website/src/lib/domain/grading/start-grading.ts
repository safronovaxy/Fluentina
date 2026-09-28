import 'server-only';

/**
 * KAN-16 / ADR-2 — starts grading for a just-created essay: writes the
 * `pending` job row, then enqueues it. Called once, from
 * `POST /api/essays`'s route handler, immediately after `submitEssay`
 * commits.
 *
 * Deliberately two separate steps, not one atomic operation: the row write
 * is what a status poll (`GET /api/essays/[id]/grading`) needs to exist
 * before it can return anything other than "not found", and it must be
 * durable BEFORE the enqueue call, not after — enqueueing first and writing
 * the row second would let a very fast inline-queue redelivery (or, in
 * production, an equally fast Cloud Tasks delivery) call `runGradingJob`
 * before the row exists to update.
 *
 * Never awaited to completion by the caller in the sense of "wait for
 * grading" — `enqueueGradingJob` itself only waits for the job to be
 * SCHEDULED (see `queue.ts`'s own comment on the inline path), which is what
 * keeps "grading runs asynchronously after submission" (this story's own
 * acceptance criterion) true regardless of which queue implementation is
 * selected.
 */
import type { GuestActor } from '@/lib/contracts/actor';
import { createGradingJob } from '@/lib/db/grading-jobs';
import { enqueueGradingJob } from './queue';

export async function startGrading(actor: GuestActor, essayId: string): Promise<void> {
  const job = await createGradingJob(actor, essayId);
  await enqueueGradingJob(job.id);
}
