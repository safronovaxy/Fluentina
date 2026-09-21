import 'server-only';

/**
 * KAN-25 — the one place the rate-limit counter is actually incremented.
 * See `rateLimitCounters`' own comment (schema.ts) for WHERE this state
 * lives and why (Postgres, shared across every Cloud Run instance, survives
 * scale-to-zero) — this file is only the query.
 *
 * No `Actor` parameter, unlike every function in `essays.ts`/
 * `guest-sessions.ts`: this table holds no owned row (no session_id/user_id
 * pair `ownedBy()` could apply to), so the ownership convention those two
 * repositories document doesn't apply here — there is nothing to own, only
 * a counter keyed by a caller-supplied string. `lib/domain/rate-limit.ts` is
 * the one caller, and it is the layer that decides what a `bucketKey` means
 * (a session id, an IP, which action) — this function trusts it verbatim.
 */
import { sql } from 'drizzle-orm';
import { db } from './client';
import { rateLimitCounters } from './schema';

/**
 * Atomically increments the counter for `(bucketKey, windowStart)` and
 * returns the count AFTER this increment.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement —
 * Postgres serialises two callers racing the same bucket in the same window
 * via the row's own lock, so this never loses an increment to a
 * read-then-write gap, whether the two callers are two requests on the same
 * Cloud Run instance or two different instances hitting the same shared
 * database. That atomicity is the entire reason this exists as its own
 * function rather than a `select count`, compare, then `insert` at the call
 * site — the second shape has exactly the race this one closes.
 */
export async function incrementRateLimitCounter(bucketKey: string, windowStart: Date): Promise<number> {
  const [row] = await db
    .insert(rateLimitCounters)
    .values({ bucketKey, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.bucketKey, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });
  return row.count;
}
