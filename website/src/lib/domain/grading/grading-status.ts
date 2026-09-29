import 'server-only';

/**
 * KAN-16 / ADR-14 layering — the adapter (`GET /api/essays/[id]/grading`)
 * imports `lib/domain`, never `lib/db` directly (the same rule every other
 * route in this codebase already follows).
 *
 * KAN-19 (BR-4.2): this is also where the response shape is DECIDED, and the
 * only place it is produced. `lib/db` returns the stored job and knows about
 * ownership (`ownedBy`); what a given actor is entitled to be told about a
 * finished grade is a different rule that will grow, and it lives here —
 * not in the route (one of N adapters; `preview/page.tsx` is already a
 * second, and a route-level rule is the copy-pasteable kind adapter #3
 * forgets) and not in `lib/db` (`getGradingJobByIdUnscoped` legitimately
 * hands the worker the full result, and a conditional redaction there would
 * put a second ownership-shaped rule in the one file meant to be auditable at
 * a glance). This function cannot be called without an `OwnerActor`.
 *
 * Order of the rules, most restrictive first:
 *  1. A flagged result is `withheld` for EVERYONE, whatever `reportAccessFor`
 *     says. What it holds is operator-facing English placeholders and the
 *     output of a model reading an essay the injection guard distrusts;
 *     `clampForSuspectedInjection` does not touch `annotations`, so those
 *     would otherwise reach the browser and be hidden only by the UI. Both
 *     flag sources are checked (the result's and the job row's own) and either
 *     one withholds: a gate that fails closed if the two ever disagree.
 *  2. Otherwise `reportAccessFor(actor)` picks `locked` or `full`.
 *
 * The worked example's sentence is cut here from the essay text, read a
 * second time through the same ownership-scoped `getOwnedEssay` — and only
 * for a succeeded, unflagged job, so the ~48 polls before it are single
 * reads. Essay text is deliberately not added to `GradingJobRecord`, which
 * keeps it out of every path that logs or sanitises a job. An essay deleted
 * between the two reads gives no example (the UI's existing "couldn't
 * pinpoint a sentence" copy), not an error. Nothing here logs: no line on
 * this path may carry essay text, the sentence cut from it, or an email.
 */
import type { OwnerActor } from '@/lib/contracts/actor';
import { RUBRIC_DIMENSIONS, type GradingResult, type RubricDimension } from '@/lib/contracts/grading';
import type { GradingJob } from '@/lib/contracts/grading-job';
import type { GradingReportView, WorkedExampleView } from '@/lib/contracts/grading-report';
import { getGradingJobByEssayId } from '@/lib/db/grading-jobs';
import { getOwnedEssay } from '@/lib/domain/essay-read';
import { reportAccessFor } from './report-access';
import { pickWorkedExample } from './worked-example';

async function workedExampleFor(actor: OwnerActor, essayId: string, result: GradingResult): Promise<WorkedExampleView | null> {
  const essay = await getOwnedEssay(actor, essayId);
  if (!essay) return null;
  const example = pickWorkedExample(essay.content, result.annotations);
  if (!example) return null;
  // Field by field on purpose: spreading `example.annotation` would put the
  // span's `start`/`end` on the wire.
  return {
    dimension: example.annotation.dimension,
    severity: example.annotation.severity,
    message: example.annotation.message,
    suggestion: example.annotation.suggestion,
    before: example.before,
    highlighted: example.highlighted,
    after: example.after,
  };
}

function countByDimension(result: GradingResult): Record<RubricDimension, number> {
  const counts = Object.fromEntries(RUBRIC_DIMENSIONS.map((dimension) => [dimension, 0])) as Record<RubricDimension, number>;
  for (const annotation of result.annotations) counts[annotation.dimension] += 1;
  return counts;
}

async function buildReport(
  actor: OwnerActor,
  essayId: string,
  result: GradingResult,
  promptInjectionSuspected: boolean,
): Promise<GradingReportView> {
  if (result.flaggedForReview || promptInjectionSuspected) return { access: 'withheld', reason: 'flaggedForReview' };

  const workedExample = await workedExampleFor(actor, essayId, result);
  if (reportAccessFor(actor) === 'full') return { access: 'full', result, workedExample };

  // Every field named, none spread from `result` — `locked` must not gain a
  // field just because `GradingResult` did.
  return {
    access: 'locked',
    overallScore: result.overallScore,
    overallBand: result.overallBand,
    annotationCount: result.annotations.length,
    annotationCountByDimension: countByDimension(result),
    workedExample,
  };
}

export async function getGradingStatus(actor: OwnerActor, essayId: string): Promise<GradingJob | null> {
  const job = await getGradingJobByEssayId(actor, essayId);
  if (!job) return null;

  return {
    status: job.status,
    createdAt: job.createdAt,
    failureReason: job.status === 'failed' ? job.errorType : null,
    report:
      job.status === 'succeeded' && job.result
        ? await buildReport(actor, essayId, job.result, job.promptInjectionSuspected)
        : null,
  };
}
