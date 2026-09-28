import 'server-only';

/**
 * The grading-jobs repository. See `schema.ts`'s own comment on why this
 * table has no `session_id`/`user_id` of its own — every ownership-scoped
 * read here joins to `essays` and applies `ownedBy()` against THAT row's
 * columns, rather than duplicating them.
 *
 * `GradingJobRecord` (this file's own, internal type) carries `rawInput`/
 * `rawOutput` — the ADR-5 persistence a future fine-tuning dataset needs.
 * `lib/contracts/grading-job.ts`'s `GradingJob` (the PUBLIC shape) does not
 * — `toPublicGradingJob` below is the one place a raw prompt/response could
 * leak into an HTTP response, and it deliberately never reads those two
 * columns off `row` when building that shape.
 */
import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { gradingJobs, essays } from './schema';
import { ownedBy } from './ownership';
import type { OwnerActor, SystemActor } from '@/lib/contracts/actor';
import type { GradingJob, GradingJobStatus } from '@/lib/contracts/grading-job';
import { isGradingFailureReason, type GradingFailureReason, type GradingResult } from '@/lib/contracts/grading';

/** Internal-only row shape — includes the ADR-5 raw persistence. Never returned from an ownership-scoped read; see this file's own top comment. */
export interface GradingJobRecord {
  readonly id: string;
  readonly essayId: string;
  readonly status: GradingJobStatus;
  readonly provider: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly errorType: GradingFailureReason | null;
  readonly promptInjectionSuspected: boolean;
  readonly rawInput: string | null;
  readonly rawOutput: string | null;
  readonly result: GradingResult | null;
}

function toStatus(value: string): GradingJobStatus {
  // Defensive narrowing against the plain-text column (schema.ts's own
  // comment on why this is text, not a Postgres enum) — a row this
  // repository itself wrote can only ever hold one of the four statuses, so
  // reaching the fallback below would mean a hand-edited row or a schema
  // drift, not a real runtime path.
  if (value === 'pending' || value === 'processing' || value === 'succeeded' || value === 'failed') return value;
  throw new Error(`grading job row carries an unrecognised status`);
}

function toFailureReason(value: string | null): GradingFailureReason | null {
  if (value === null) return null;
  return isGradingFailureReason(value) ? value : 'unknown';
}

function toRecord(row: typeof gradingJobs.$inferSelect): GradingJobRecord {
  return {
    id: row.id,
    essayId: row.essayId,
    status: toStatus(row.status),
    provider: row.provider,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    errorType: toFailureReason(row.errorType),
    promptInjectionSuspected: row.promptInjectionSuspected,
    rawInput: row.rawInput,
    rawOutput: row.rawOutput,
    result: (row.result as GradingResult | null) ?? null,
  };
}

/** The public, HTTP-safe view — see this file's own top comment for why `rawInput`/`rawOutput` never reach here. */
export function toPublicGradingJob(record: GradingJobRecord): GradingJob {
  return {
    id: record.id,
    essayId: record.essayId,
    status: record.status,
    provider: record.provider,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    result: record.status === 'succeeded' ? record.result : null,
    failureReason: record.status === 'failed' ? record.errorType : null,
  };
}

/**
 * Creates the `pending` row for a just-submitted essay. Called once, from
 * `lib/domain/grading/start-grading.ts`, immediately after `createEssay`
 * commits — `essayId` is trusted to already exist (the caller just created
 * it in the same request) and the FK enforces that regardless.
 */
export async function createGradingJob(actor: OwnerActor, essayId: string): Promise<GradingJobRecord> {
  void actor; // no owner columns to write here — see this file's own top comment; kept for call-site auditability, matching every other repository function in this codebase.
  const [row] = await db.insert(gradingJobs).values({ essayId }).returning();
  return toRecord(row);
}

/**
 * Ownership-scoped read, joined through `essays` — this is what
 * `GET /api/essays/[id]/grading` calls, and the only place a guest or
 * registered user ever reads a grading job. Returns null both when no job
 * exists for that essay and when the essay itself isn't `actor`'s (or
 * doesn't exist at all) — the same "not found and not yours are outwardly
 * identical" rule `getEssayById` already documents.
 */
export async function getGradingJobByEssayId(actor: OwnerActor, essayId: string): Promise<GradingJobRecord | null> {
  const [row] = await db
    .select({ job: gradingJobs })
    .from(gradingJobs)
    .innerJoin(essays, eq(gradingJobs.essayId, essays.id))
    .where(and(eq(gradingJobs.essayId, essayId), ownedBy(actor, { sessionId: essays.sessionId, userId: essays.userId })));
  return row ? toRecord(row.job) : null;
}

/**
 * Unscoped read for the grading worker itself (`orchestrate-grading.ts`) —
 * it has no end-user actor, only a job id handed to it by the queue. Grep
 * "Unscoped" to find every place ownership is deliberately bypassed, per
 * this codebase's own convention (see `lib/db/essays.ts`).
 */
export async function getGradingJobByIdUnscoped(actor: SystemActor, jobId: string): Promise<GradingJobRecord | null> {
  void actor;
  const [row] = await db.select().from(gradingJobs).where(eq(gradingJobs.id, jobId));
  return row ? toRecord(row) : null;
}

export async function markGradingJobProcessing(actor: SystemActor, jobId: string): Promise<void> {
  void actor;
  await db.update(gradingJobs).set({ status: 'processing' }).where(eq(gradingJobs.id, jobId));
}

export interface GradingJobSuccessInput {
  readonly provider: string;
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly result: GradingResult;
  readonly promptInjectionSuspected: boolean;
}

export async function markGradingJobSucceeded(actor: SystemActor, jobId: string, input: GradingJobSuccessInput): Promise<void> {
  void actor;
  await db
    .update(gradingJobs)
    .set({
      status: 'succeeded',
      provider: input.provider,
      rawInput: input.rawInput,
      rawOutput: input.rawOutput,
      result: input.result,
      promptInjectionSuspected: input.promptInjectionSuspected,
      completedAt: new Date(),
    })
    .where(eq(gradingJobs.id, jobId));
}

export async function markGradingJobFailed(
  actor: SystemActor,
  jobId: string,
  errorType: GradingFailureReason,
  provider: string | null = null,
): Promise<void> {
  void actor;
  await db
    .update(gradingJobs)
    .set({ status: 'failed', errorType, provider, completedAt: new Date() })
    .where(eq(gradingJobs.id, jobId));
}
