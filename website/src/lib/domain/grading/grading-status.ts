import 'server-only';

/**
 * KAN-16 / ADR-14 layering — the adapter (`GET /api/essays/[id]/grading`)
 * imports `lib/domain`, never `lib/db` directly (the same rule every other
 * route in this codebase already follows). This is the one-line seam that
 * makes that true here: it does nothing but forward to
 * `lib/db/grading-jobs.ts`'s ownership-scoped read and its public-shape
 * mapper.
 */
import type { OwnerActor } from '@/lib/contracts/actor';
import type { GradingJob } from '@/lib/contracts/grading-job';
import { getGradingJobByEssayId, toPublicGradingJob } from '@/lib/db/grading-jobs';

export async function getGradingStatus(actor: OwnerActor, essayId: string): Promise<GradingJob | null> {
  const job = await getGradingJobByEssayId(actor, essayId);
  return job ? toPublicGradingJob(job) : null;
}
