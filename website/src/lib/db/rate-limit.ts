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
import { lt, sql } from 'drizzle-orm';
import { db } from './client';
import { rateLimitCounters } from './schema';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

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
 *
 * KAN-25 item 4 (round-1 review, Architect, blocking): also sweeps rows more
 * than two windows stale, on every call — see `deleteStaleRateLimitCounters`
 * and `rateLimitCounters`' own schema.ts comment for why this runs here,
 * inline, rather than on a scheduled path that does not exist in this
 * codebase. An extra statement on every rate-limit check is a real cost,
 * accepted deliberately: in steady state the previous call already swept
 * everything older than its own cutoff, so this one typically deletes
 * nothing or close to it — the indexed range scan (`windowStartIdx`) only
 * does real work after a gap in traffic, not on every request.
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
  await deleteStaleRateLimitCounters(windowStart);
  return row.count;
}

/**
 * Deletes every counter row whose `windowStart` is more than two hours
 * behind `referenceWindowStart`, returning the number of rows deleted.
 *
 * Two hours, not the window length itself (one hour today): a fixed-window
 * counter needs at most the CURRENT and the IMMEDIATELY PRECEDING window to
 * answer any question `lib/domain/rate-limit.ts` ever asks of it — anything
 * older is dead weight, personal data (a session id or client address,
 * embedded in `bucketKey`) with no further purpose. The extra hour of
 * margin over the bare minimum is deliberate slack against clock skew
 * between the `now` a caller passes in and this table's own rows, not a
 * claim that anything past one stale window is ever read again.
 *
 * Exported (not `incrementRateLimitCounter`-internal only) so a future
 * scheduled path — once one exists anywhere in this codebase, see
 * schema.ts's own comment — can call this directly instead of forcing an
 * unrelated increment.
 */
export async function deleteStaleRateLimitCounters(referenceWindowStart: Date): Promise<number> {
  const cutoff = new Date(referenceWindowStart.getTime() - TWO_HOURS_MS);
  const deleted = await db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.windowStart, cutoff))
    .returning({ bucketKey: rateLimitCounters.bucketKey });
  return deleted.length;
}
