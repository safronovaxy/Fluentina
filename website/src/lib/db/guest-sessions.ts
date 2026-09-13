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
import { db } from './client';
import { essays, guestSessions } from './schema';
import { ownedBy } from './ownership';
import type { GuestSession } from '@/lib/contracts/guest-session';
import type { GuestActor, OwnerActor } from '@/lib/contracts/actor';

function toGuestSession(row: typeof guestSessions.$inferSelect): GuestSession {
  return {
    id: row.id,
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
 */
export async function createGuestSession(actor: GuestActor): Promise<GuestSession> {
  const [row] = await db
    .insert(guestSessions)
    .values({ id: actor.sessionId })
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
 * Attaches a guest session — and every essay currently owned under it — to
 * a registered account. This is the acceptance criterion "after a guest
 * converts, the old session id must stop authorising reads" made concrete:
 * once this commits, `userId` is set on both the session row and its
 * essays, so `ownedBy()`'s `isNull(userId)` conjunct fails for the old
 * `GuestActor` on every one of them from then on.
 *
 * Takes a `GuestActor` specifically (only a guest can convert their own
 * session — a registered user has nothing to convert). Uses the exact same
 * `ownedBy()` predicate the read paths use to select the essay rows to
 * update, rather than a hand-rolled `sessionId` match, so a session that
 * has already been converted (`userId` no longer null) cannot be
 * re-converted or have its essays re-attached by a second call: `ownedBy`
 * would find zero rows for the stale `GuestActor`, and the function throws
 * rather than silently no-op'ing.
 */
export async function convertGuestSessionToUser(actor: GuestActor, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [convertedSession] = await tx
      .update(guestSessions)
      .set({ userId, convertedAt: new Date() })
      .where(ownedBy(actor, { sessionId: guestSessions.id, userId: guestSessions.userId }))
      .returning();

    if (!convertedSession) {
      throw new Error(
        'cannot convert guest session: no unconverted session found for this actor ' +
          '(already converted, or the session id does not exist)',
      );
    }

    await tx
      .update(essays)
      .set({ userId })
      .where(ownedBy(actor, { sessionId: essays.sessionId, userId: essays.userId }));
  });
}
