import 'server-only';

/**
 * The grading-jobs repository. See `schema.ts`'s own comment on why this
 * table has no `session_id`/`user_id` of its own — every ownership-scoped
 * read here joins to `essays` and applies `ownedBy()` against THAT row's
 * columns, rather than duplicating them.
 *
 * `GradingJobRecord` (this file's own, internal type) carries `rawInput`/
 * `rawOutput` — the ADR-5 persistence a future fine-tuning dataset needs, and
 * the full `GradingResult`. Nothing in this file produces an HTTP-facing
 * shape, on purpose (KAN-19): a `toPublic…` mapper here took a record and
 * returned the full result with no actor anywhere in its signature, which is
 * the hazard. What a caller may be told about a job is decided by
 * `lib/domain/grading/grading-status.ts::getGradingStatus`, which cannot be
 * called without an `OwnerActor`; this file's job is ownership (`ownedBy`).
 */
import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { gradingJobs, essays } from './schema';
import { ownedBy } from './ownership';
import type { OwnerActor, SystemActor } from '@/lib/contracts/actor';
import type { GradingJobStatus } from '@/lib/contracts/grading-job';
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

/**
 * Creates the `pending` row for a just-submitted essay — ownership-scoped,
 * per KAN-16 round-1 review (finding 3): the only caller today
 * (`start-grading.ts`) passes an essay it just created itself, so `actor`
 * owning `essayId` always held in practice, but nothing below this call
 * site ever checked it. That made the check purely decorative — the
 * `void actor` this replaced satisfied ADR-14's "every write takes an
 * actor" rule in letter only, and the very next caller of this function
 * (a re-grade/retry endpoint being the obvious one) could pass ANY essay
 * id, including another guest's, and get back a real job that dispatches a
 * paid provider call against someone else's text.
 *
 * Scoped inside a transaction rather than a single `INSERT ... SELECT`:
 * this codebase's existing idiom for "check ownership, then write"
 * (`essays.ts`'s own `createEssay`) is a transactional select-then-insert,
 * and Drizzle's `.insert().select()` column-mapping is untested territory
 * here — this keeps the same, already-reviewed pattern rather than
 * introducing a new one for a single call site. Returns `null`, exactly
 * like every other ownership-scoped read in this file, when the essay
 * doesn't exist OR isn't `actor`'s — never distinguishable from the
 * caller's side, same "not found and not yours look identical" rule.
 */
export async function createGradingJob(actor: OwnerActor, essayId: string): Promise<GradingJobRecord | null> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: essays.id })
      .from(essays)
      .where(and(eq(essays.id, essayId), ownedBy(actor, { sessionId: essays.sessionId, userId: essays.userId })));
    if (!owned) return null;

    const [row] = await tx.insert(gradingJobs).values({ essayId }).returning();
    return toRecord(row);
  });
}

/**
 * Ownership-scoped read, joined through `essays` — what `getGradingStatus`
 * (behind `GET /api/essays/[id]/grading`) calls, and the only place a guest or
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

/**
 * Unscoped — renamed from `markGradingJobProcessing` (KAN-16 round-1 review,
 * finding 3's "related and cheap" item): every other system-only write in
 * this codebase is named `*Unscoped` specifically so `grep Unscoped` finds
 * every deliberate ownership bypass in one pass (see `essays.ts`'s own
 * comment); this one wasn't, which silently broke that audit.
 *
 * Also the fix for finding 5: `WHERE id = $1` alone made this an
 * unconditional claim — two concurrent deliveries of the same job (Cloud
 * Tasks is at-least-once; ADR-2 says so directly) both read `pending`, both
 * passed the `orchestrate-grading.ts` guard (which only short-circuits
 * `succeeded`/`failed`), and both called the provider, double-billing one
 * guest submission. `AND status = 'pending'` plus `RETURNING id` turns the
 * claim itself atomic: only the delivery whose UPDATE actually matched a row
 * gets `true` back, so a second, racing delivery can tell it lost and skip
 * calling the provider at all. This is what "idempotent by construction" in
 * `orchestrate-grading.ts`'s own top comment actually requires — it was true
 * for terminal states and false for in-flight ones before this.
 */
export async function markGradingJobProcessingUnscoped(actor: SystemActor, jobId: string): Promise<boolean> {
  void actor;
  // TODO(KAN-38): this atomic claim has no way back out of `processing` if the instance that
  // claimed the job is evicted, OOMs, or is replaced by a deploy before any terminal write. A
  // redelivery then fails to claim it (correctly — the row isn't `pending`), `runGradingJob`
  // reports `'noop'`, the route answers 200, Cloud Tasks considers the task done, and the guest
  // polls forever with no telemetry line recorded. Before this atomicity fix the unconditional
  // claim made this self-healing; closing it needs a `claimed_at`/`updated_at` column plus either
  // a reaper or a widened claim predicate — already tracked on KAN-38, deliberately not in this PR.
  const [claimed] = await db
    .update(gradingJobs)
    .set({ status: 'processing' })
    .where(and(eq(gradingJobs.id, jobId), eq(gradingJobs.status, 'pending')))
    .returning({ id: gradingJobs.id });
  return claimed !== undefined;
}

export interface GradingJobSuccessInput {
  readonly provider: string;
  readonly rawInput: string;
  readonly rawOutput: string;
  readonly result: GradingResult;
  readonly promptInjectionSuspected: boolean;
}

/** Unscoped — see `markGradingJobProcessingUnscoped`'s own comment on the naming convention this restores. */
export async function markGradingJobSucceededUnscoped(actor: SystemActor, jobId: string, input: GradingJobSuccessInput): Promise<void> {
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

/** Unscoped — see `markGradingJobProcessingUnscoped`'s own comment on the naming convention this restores. */
export async function markGradingJobFailedUnscoped(
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

/**
 * Reverts a claimed job back to `pending` — KAN-16 round-1 review, finding
 * 13: used only for a transient `providerError` that hasn't exhausted its
 * retry budget yet (`orchestrate-grading.ts`'s own comment), so the NEXT
 * Cloud Tasks redelivery can reclaim it via `markGradingJobProcessingUnscoped`'s
 * own `WHERE status = 'pending'` condition. Never called for a terminal
 * outcome — those go through `markGradingJobSucceededUnscoped`/
 * `markGradingJobFailedUnscoped` instead.
 */
export async function revertGradingJobToPendingUnscoped(actor: SystemActor, jobId: string): Promise<void> {
  void actor;
  await db.update(gradingJobs).set({ status: 'pending' }).where(eq(gradingJobs.id, jobId));
}
