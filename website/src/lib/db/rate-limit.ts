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
 * nothing or close to it — the indexed range scan
 * (`rate_limit_counters_window_start_idx`, schema.ts) only does real work
 * after a gap in traffic, not on every request.
 *
 * Round-2 review (Architect, blocking): the sweep below used to be awaited
 * un-guarded, so a failure in it propagated straight out of this function.
 * By the point the sweep runs, the increment above has already committed —
 * `row.count` is already the correct decision this call exists to make. The
 * sweep is a SECOND, independent connection checkout on top of that; letting
 * it fail the whole call turned a correct rate-limit decision into a server
 * error for the caller, for any of the ordinary reasons a second round trip
 * can fail (a pool exhausted by concurrent load, a transient connection
 * drop). Best-effort: caught and swallowed below, since every call to this
 * function sweeps — a failed sweep this time is retried by the very next
 * increment against the same or a later window, not lost. The Architect's
 * own single-statement alternative (folding the delete into the insert,
 * halving the round trips) was explicitly not taken: it would couple the
 * two, so a sweep failure would then fail the increment too — the exact
 * coupling this fix removes.
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
  try {
    await deleteStaleRateLimitCounters(windowStart);
  } catch {
    // Best-effort — see this function's own comment above. Deliberately
    // swallowed, not logged: the error carries no bucketKey (personal data)
    // itself, but a repeatedly-failing sweep is exactly the ordinary-cost
    // background noise a per-call log line would turn into alert fatigue for
    // no actionable gain the next successful sweep doesn't already recover.
  }
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
 * INVARIANT this cutoff relies on (round-2 review, Test Lead — stated
 * explicitly, not fixed, since fixing it properly means deriving the cutoff
 * from the longest declared window instead of a bare constant): every
 * action declared in `lib/domain/rate-limit.ts` today uses an hourly window
 * (`*_WINDOW_MS`, all equal to one hour), and the delete below is NOT scoped
 * to a particular action's own bucket prefix — it sweeps every bucket whose
 * `windowStart` is stale by this one fixed margin. That is correct only
 * because two hours safely exceeds every window declared today. A future
 * action with a LONGER window (a daily cap, say) would have its
 * still-mid-window counter deleted by an ordinary hourly sweep, silently
 * resetting it early. Adding such an action must either widen
 * `TWO_HOURS_MS` to cover the new longest window, or scope this delete by
 * action so each one's own margin applies independently.
 *
 * Exported (not `incrementRateLimitCounter`-internal only) so a future
 * scheduled path — once one exists anywhere in this codebase, see
 * schema.ts's own comment — can call this directly instead of forcing an
 * unrelated increment.
 *
 * Round-2 review (Architect): this used to ask Postgres to RETURN every
 * deleted row just to count them (`.returning(...).length`) — after a
 * traffic gap on a service that scales to zero, the first request back pays
 * to materialise the entire backlog into memory at once, which the
 * Architect's own estimate for that backlog under sustained abuse puts on
 * the order of a hundred thousand rows. `rowCount` (below) is the driver's
 * own count of rows affected by the statement, with none of them ever
 * transferred back.
 */
export async function deleteStaleRateLimitCounters(referenceWindowStart: Date): Promise<number> {
  const cutoff = new Date(referenceWindowStart.getTime() - TWO_HOURS_MS);
  const result = await db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, cutoff));
  return result.rowCount ?? 0;
}
