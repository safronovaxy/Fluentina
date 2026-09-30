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
import { essays, guestSessions } from './schema';
import { ownedBy } from './ownership';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import type { Essay } from '@/lib/contracts/essay';
import type { OwnerActor, SystemActor } from '@/lib/contracts/actor';

function toEssay(row: typeof essays.$inferSelect): Essay {
  return {
    id: row.id,
    // The one explicit conversion from a raw database string to the branded
    // `GuestSessionId` — see the brand comment on `guestSessionIdSchema`.
    // NULL for every account-owned essay (KAN-52): `parse(null)` would throw.
    sessionId: row.sessionId === null ? null : guestSessionIdSchema.parse(row.sessionId),
    userId: row.userId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

/**
 * Creates an essay owned by `actor`. Exactly one owner column is written —
 * the `essays_exactly_one_owner` CHECK refuses a row with both or neither.
 *
 * REGISTERED USER: a plain insert with `user_id` set and `session_id` NULL. No
 * `guest_sessions` row is read, locked or created — there is none to lock, and
 * so the conversion race described below cannot occur for this actor. (Before
 * KAN-52 there was no user branch: `createEssay` took a `GuestActor`, so a
 * registered user's submission created a guest-owned essay their account could
 * not read, and a registered user with no guest cookie could not submit at
 * all, because `session_id` was NOT NULL.)
 *
 * GUEST: runs inside a transaction that locks the session row (`FOR UPDATE`)
 * before inserting, and reads whatever `user_id` is on that row. Without the
 * lock, a request still carrying a stale (but not-yet-deleted) session id
 * could write an essay after its session had already converted: the FK to
 * `guest_sessions` is still satisfied, so the insert would succeed with
 * `user_id` left null — a row the account that wrote it can never read again,
 * but the stale guest session still can (the exact leak this story exists to
 * close), and one the retention sweep eventually deletes as abandoned. Locking
 * the session row serialises this against `convertGuestSessionToUser`, which
 * takes the same row lock, so a write racing a concurrent conversion either
 * sees the pre-conversion (still null) or post-conversion (already attached)
 * `user_id`, never an unattached row for an already-converted session. A
 * session id that names no row at all — forged, or its session was somehow
 * deleted — throws rather than inserting an essay with a dangling
 * `session_id`.
 *
 * THE POST-CONVERSION BRANCH WRITES ONLY `user_id`. When the locked session
 * has already converted, the essay belongs to that account, so `session_id`
 * is written NULL, exactly as conversion itself nulls it on the essays it
 * moves. Copying `session.userId` while ALSO writing `actor.sessionId` (what
 * this function did before KAN-52) would set both columns and fire the CHECK
 * — in production, from a stale-but-valid guest cookie, the documented race.
 */
export async function createEssay(actor: OwnerActor, content: string): Promise<Essay> {
  if (actor.kind === 'user') {
    const [row] = await db.insert(essays).values({ sessionId: null, userId: actor.userId, content }).returning();
    return toEssay(row);
  }

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ userId: guestSessions.userId })
      .from(guestSessions)
      .where(eq(guestSessions.id, actor.sessionId))
      .for('update');

    if (!session) {
      // KAN-24 (round-review, carried over from an earlier PR): this used to
      // interpolate `actor.sessionId` — a live bearer credential, the only
      // thing authorising reads of this guest's own essays (see
      // `guestSessionIdSchema`'s own comment) — straight into the thrown
      // message. Nothing above this call wraps the transaction, so any
      // uncaught throw here becomes a framework 500 whose message Next logs
      // verbatim; a session row that's read here and deleted moments later
      // (a right-to-erasure cascade, or the 30-day retention sweep catching
      // it on the boundary — both real, both already-known races per
      // `resolveGuestSession`'s own `SessionIdUnavailableError` comment)
      // would put that credential straight into production logs. No
      // identifier at all here — the route (`POST /api/essays`) is what
      // logs an outcome for this endpoint (KAN-24), and it does so without
      // ever needing this message's content.
      throw new Error('cannot create essay: guest session no longer exists');
    }

    const [row] = await tx
      .insert(essays)
      .values({
        // Exactly one owner column (see this function's own comment): the
        // session while it is unconverted, the account once it has converted.
        sessionId: session.userId === null ? actor.sessionId : null,
        userId: session.userId,
        content,
      })
      .returning();
    return toEssay(row);
  });
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
