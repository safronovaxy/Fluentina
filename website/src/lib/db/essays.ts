import 'server-only';

/**
 * The essays repository. Storage and ownership only, per KAN-10's scope —
 * word-count limits, grading, and the submission API are KAN-14's job, not
 * this one. Every function here takes its caller's `Actor` as a required
 * first parameter; there is no generic "run this query" export to route
 * around that.
 */
import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { essays } from './schema';
import { ownedBy } from './ownership';
import type { Essay } from '@/lib/contracts/essay';
import type { GuestActor, OwnerActor, SystemActor } from '@/lib/contracts/actor';

function toEssay(row: typeof essays.$inferSelect): Essay {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

/**
 * Creates an essay under a guest session. Every essay originates under a
 * session (KAN-10 scope: "guest sessions, and essays associated with a
 * session") — `actor` is a `GuestActor` specifically, not the wider
 * `OwnerActor`, because an essay's `user_id` is only ever populated later,
 * in bulk, by `convertGuestSessionToUser` — never set directly at creation.
 * A registered user has no separate "create an essay as myself" path here;
 * their essays are ones whose originating session was later converted.
 */
export async function createEssay(actor: GuestActor, content: string): Promise<Essay> {
  const [row] = await db
    .insert(essays)
    .values({
      sessionId: actor.sessionId,
      content,
    })
    .returning();
  return toEssay(row);
}

/**
 * Reads one essay, scoped to `actor`'s ownership. Returns null both when
 * the id doesn't exist and when it exists but `actor` doesn't own it —
 * deliberately the same outward result, so a caller can't distinguish
 * "not found" from "not yours" by branching on the response.
 */
export async function getEssayById(actor: OwnerActor, essayId: string): Promise<Essay | null> {
  const [row] = await db
    .select()
    .from(essays)
    .where(and(eq(essays.id, essayId), ownedBy(actor, { sessionId: essays.sessionId, userId: essays.userId })));
  return row ? toEssay(row) : null;
}

/**
 * Unscoped read for system jobs (e.g. a grading worker) that need an essay
 * without an end-user actor to check ownership against — "system" means
 * ownership does not apply, not "no filter", so this is a separately named
 * function rather than a branch inside `getEssayById`. Grep "Unscoped" to
 * find every place ownership is deliberately bypassed.
 */
export async function getEssayByIdUnscoped(
  actor: SystemActor,
  essayId: string,
): Promise<Essay | null> {
  void actor; // required first parameter for consistency and for call-site auditability, unused otherwise
  const [row] = await db.select().from(essays).where(eq(essays.id, essayId));
  return row ? toEssay(row) : null;
}
