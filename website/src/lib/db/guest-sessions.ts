import 'server-only';

/**
 * The guest sessions repository, including conversion — the persistence-
 * layer half of "a guest converts to a registered account." Issuing the
 * session cookie and everything that drives conversion from a route are a
 * separate, later story (KAN-9's `src/middleware.ts` lands first); this is
 * only the data-layer mutation, and it is what the ownership test suite
 * exercises to prove the cutover rule actually holds against real rows.
 */
import { eq, and } from 'drizzle-orm';
import { db, type Executor } from './client';
import { essays, guestSessions } from './schema';
import { ownedBy } from './ownership';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import type { GuestSession } from '@/lib/contracts/guest-session';
import type { GuestActor, OwnerActor } from '@/lib/contracts/actor';

function toGuestSession(row: typeof guestSessions.$inferSelect): GuestSession {
  return {
    // The one explicit conversion from a raw database string to the branded
    // `GuestSessionId` — see the brand comment on `guestSessionIdSchema`.
    id: guestSessionIdSchema.parse(row.id),
    userId: row.userId,
    createdAt: row.createdAt,
    convertedAt: row.convertedAt,
  };
}

/**
 * Persists a freshly generated session id (see
 * `lib/domain/session-id.ts::generateGuestSessionId`). Takes the `GuestActor`
 * built from that id, not the bare string, so every repository function —
 * including this one — takes an Actor as its first parameter without
 * exception.
 *
 * Re-parses `actor.sessionId` before inserting even though the type is
 * already the branded `GuestSessionId` — the brand is a compile-time
 * guarantee only, and is erased by a forced cast (`as GuestSessionId`) at
 * whatever boundary eventually builds a `GuestActor` from a cookie (KAN-9).
 * This is the one function that turns a session id into a primary key, so
 * it is the one place that cannot trust the type alone: a malformed or
 * attacker-chosen id is rejected here, at runtime, rather than silently
 * becoming a row someone else already knows the id of and can read.
 */
export async function createGuestSession(actor: GuestActor): Promise<GuestSession> {
  const sessionId = guestSessionIdSchema.parse(actor.sessionId);
  const [row] = await db
    .insert(guestSessions)
    .values({ id: sessionId })
    .returning();
  return toGuestSession(row);
}

/**
 * Reads one guest session, scoped to `actor`'s ownership. Same "not found"
 * and "not yours" collapse as `getEssayById` — see that function's comment.
 */
export async function getGuestSessionById(
  actor: OwnerActor,
  sessionId: string,
): Promise<GuestSession | null> {
  const [row] = await db
    .select()
    .from(guestSessions)
    .where(
      and(
        eq(guestSessions.id, sessionId),
        ownedBy(actor, { sessionId: guestSessions.id, userId: guestSessions.userId }),
      ),
    );
  return row ? toGuestSession(row) : null;
}

/**
 * The outcome of a conversion attempt. `nothingToConvert` is the EXPECTED
 * non-event, not a failure: no guest session row for this actor, or one that
 * has already converted (a second tab registering, a replayed request), or
 * one retention has since deleted. In all three there is no essay to strand,
 * so registering must still succeed — a 500 on "registered twice in two tabs"
 * would be a terrible first experience.
 *
 * `nothingToConvert` must NEVER be counted as a conversion metric: retention
 * deletion produces it too, so counting it would mislabel a deleted session
 * as a conversion (the same caveat `SessionIdUnavailableError` carries in
 * lib/domain/guest-session.ts).
 */
export type GuestConversionOutcome = 'converted' | 'nothingToConvert';

/**
 * Attaches a guest session — and every essay currently owned under it — to
 * a registered account. This is the acceptance criterion "after a guest
 * converts, the old session id must stop authorising reads" made concrete:
 * once this commits, `userId` is set on both the session row and its essays,
 * so `ownedBy()`'s `isNull(userId)` conjunct fails for the old `GuestActor`
 * on the session row, and — since KAN-52 — every essay it moved has its
 * `session_id` set to NULL in the same UPDATE, so the old id matches no essay
 * at all.
 *
 * `session_id` is nulled on the essays, not left as provenance. That is what
 * the `essays_exactly_one_owner` CHECK requires (an account-owned essay has
 * one owner column, not two), and it takes the essay out of the
 * `guest_sessions` ON DELETE CASCADE: an account's history no longer hangs
 * off a session row a retention sweep could delete.
 *
 * Takes a `GuestActor` specifically (only a guest can convert their own
 * session — a registered user has nothing to convert). Uses the exact same
 * `ownedBy()` predicate the read paths use to select the essay rows to
 * update, rather than a hand-rolled `sessionId` match, so a session that
 * has already been converted (`userId` no longer null) cannot be
 * re-converted or have its essays re-attached by a second call: `ownedBy`
 * would find zero rows for the stale `GuestActor`, and this returns
 * `'nothingToConvert'` without touching anything.
 *
 * This is the body of the conversion, taking the caller's transaction (see
 * `Executor`). Registration (lib/db/users.ts) calls it from inside the one
 * transaction that also inserts the user, the consent rows and the login
 * session: conversion committing while the session insert failed would leave
 * a person with an account they are not signed into, `essays.user_id` set so
 * the guest branch of `ownedBy` no longer matches their cookie, and their
 * essay unreachable as either identity, permanently, with no error saying why.
 *
 * A genuine driver error still throws — and rolls the caller's transaction
 * back.
 */
export async function convertGuestSessionToUserWithin(
  tx: Executor,
  actor: GuestActor,
  userId: string,
): Promise<GuestConversionOutcome> {
  const [convertedSession] = await tx
    .update(guestSessions)
    .set({ userId, convertedAt: new Date() })
    .where(ownedBy(actor, { sessionId: guestSessions.id, userId: guestSessions.userId }))
    .returning();

  if (!convertedSession) return 'nothingToConvert';

  // `sessionId: null` is not tidiness: the CHECK on `essays` forbids both
  // columns being set, and this write is what makes that true after
  // conversion. Do not drop it.
  await tx
    .update(essays)
    .set({ userId, sessionId: null })
    .where(ownedBy(actor, { sessionId: essays.sessionId, userId: essays.userId }));
  return 'converted';
}

/**
 * Standalone conversion in its own transaction. Not for composing into a
 * larger unit — `db.transaction` does not nest; use
 * `convertGuestSessionToUserWithin` for that.
 */
export async function convertGuestSessionToUser(actor: GuestActor, userId: string): Promise<GuestConversionOutcome> {
  return db.transaction((tx) => convertGuestSessionToUserWithin(tx, actor, userId));
}
