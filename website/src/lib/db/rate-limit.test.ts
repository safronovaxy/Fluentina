/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { deleteStaleRateLimitCounters, incrementRateLimitCounter } from './rate-limit';
import { db } from './client';
import { rateLimitCounters } from './schema';
import { resetDatabase, closePool } from '@/test/db-fixtures';

async function rowExists(bucketKey: string, windowStart: Date): Promise<boolean> {
  const rows = await db
    .select({ bucketKey: rateLimitCounters.bucketKey })
    .from(rateLimitCounters)
    .where(and(eq(rateLimitCounters.bucketKey, bucketKey), eq(rateLimitCounters.windowStart, windowStart)));
  return rows.length > 0;
}

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('incrementRateLimitCounter — the one atomic statement KAN-25 rests on', () => {
  it('starts a never-before-seen bucket at 1', async () => {
    const count = await incrementRateLimitCounter('test:bucket', new Date('2026-01-01T00:00:00Z'));

    expect(count).toBe(1);
  });

  it('increments the same bucket and window on each call, returning the running total', async () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');

    const first = await incrementRateLimitCounter('test:bucket', windowStart);
    const second = await incrementRateLimitCounter('test:bucket', windowStart);
    const third = await incrementRateLimitCounter('test:bucket', windowStart);

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it('keeps two different bucket keys in the same window independent', async () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');

    await incrementRateLimitCounter('test:bucket-a', windowStart);
    await incrementRateLimitCounter('test:bucket-a', windowStart);
    const bucketBCount = await incrementRateLimitCounter('test:bucket-b', windowStart);

    expect(bucketBCount).toBe(1);
  });

  it('keeps the same bucket key in two different windows independent — a new window starts back at 1, not carrying over the previous window\'s count', async () => {
    const firstWindow = new Date('2026-01-01T00:00:00Z');
    const secondWindow = new Date('2026-01-01T01:00:00Z');

    await incrementRateLimitCounter('test:bucket', firstWindow);
    await incrementRateLimitCounter('test:bucket', firstWindow);
    const secondWindowCount = await incrementRateLimitCounter('test:bucket', secondWindow);

    expect(secondWindowCount).toBe(1);
  });

  // The property the whole design rests on (schema.ts's own comment): two
  // callers racing the SAME bucket and window must never lose an increment
  // to a read-then-write gap. Issuing every increment concurrently, rather
  // than awaiting each one in turn, is what actually exercises the race —
  // a sequential loop would never observe it even if the underlying
  // statement weren't atomic.
  it('never loses an increment when many callers race the same bucket and window concurrently', async () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const concurrentCallers = 25;

    const counts = await Promise.all(
      Array.from({ length: concurrentCallers }, () => incrementRateLimitCounter('test:race', windowStart)),
    );

    // Every increment must have observed a DIFFERENT count — a lost update
    // would show up as a repeated value (two callers both reading/writing 5,
    // say), and the final count must equal the number of callers, not fewer.
    expect(new Set(counts).size).toBe(concurrentCallers);
    expect(Math.max(...counts)).toBe(concurrentCallers);
  });
});

describe('deleteStaleRateLimitCounters — KAN-25 item 4 (round-1 review, Architect, blocking): bounded growth, bounded retention of personal data', () => {
  it('deletes a row whose window is more than two hours behind the reference window', async () => {
    const staleWindow = new Date('2026-01-01T00:00:00Z');
    const referenceWindow = new Date('2026-01-01T03:00:00Z'); // 3h later — outside the 2h margin
    await incrementRateLimitCounter('test:stale', staleWindow);

    const deletedCount = await deleteStaleRateLimitCounters(referenceWindow);

    expect(deletedCount).toBeGreaterThanOrEqual(1);
    expect(await rowExists('test:stale', staleWindow)).toBe(false);
  });

  it('keeps a row inside the two-hour margin — the immediately preceding window is not swept away', async () => {
    const recentWindow = new Date('2026-01-01T00:00:00Z');
    const referenceWindow = new Date('2026-01-01T01:00:00Z'); // 1h later — inside the 2h margin
    await incrementRateLimitCounter('test:recent', recentWindow);

    await deleteStaleRateLimitCounters(referenceWindow);

    expect(await rowExists('test:recent', recentWindow)).toBe(true);
  });

  it('keeps a row exactly at the two-hour boundary — the cutoff is strictly older than, not at or older than', async () => {
    const boundaryWindow = new Date('2026-01-01T00:00:00Z');
    const referenceWindow = new Date('2026-01-01T02:00:00Z'); // exactly 2h later
    await incrementRateLimitCounter('test:boundary', boundaryWindow);

    await deleteStaleRateLimitCounters(referenceWindow);

    expect(await rowExists('test:boundary', boundaryWindow)).toBe(true);
  });

  // The property item 4 actually exists to guarantee: growth from
  // `incrementRateLimitCounter` itself is bounded, not merely bounded when
  // some separate cleanup call happens to also run. No scheduled cleanup
  // path exists anywhere in this codebase (see schema.ts's own comment) —
  // this proves the sweep runs on the write path itself, not only when
  // `deleteStaleRateLimitCounters` is called directly, the way the three
  // tests above do.
  it('incrementRateLimitCounter itself sweeps stale rows, on every call, with no separate cleanup call needed', async () => {
    const staleWindow = new Date('2026-01-01T00:00:00Z');
    const freshWindow = new Date('2026-01-01T05:00:00Z'); // 5h later — well outside the 2h margin
    await incrementRateLimitCounter('test:stale-via-increment', staleWindow);

    await incrementRateLimitCounter('test:unrelated', freshWindow);

    expect(await rowExists('test:stale-via-increment', staleWindow)).toBe(false);
  });

  // Round-2 review (Architect, blocking): the increment above has already
  // committed by the time the sweep runs — the count this function returns
  // is already the right rate-limit decision. The sweep is a SECOND,
  // independent connection checkout; a failure in it used to propagate out
  // of `incrementRateLimitCounter` itself, turning an already-correct
  // decision into a server error for the caller. `db.delete` is mocked to
  // throw — the exact shape any of the ordinary reasons a second round trip
  // can fail (pool exhaustion, a transient connection drop) would produce —
  // and the increment must still return the correct count regardless.
  it('does not fail the increment when the stale-row sweep throws — best-effort, the next increment retries the sweep', async () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const deleteSpy = vi.spyOn(db, 'delete').mockImplementation(() => {
      throw new Error('simulated sweep failure — a connection-pool exhaustion or transient drop, not anything about this bucket');
    });
    try {
      const count = await incrementRateLimitCounter('test:sweep-failure', windowStart);

      expect(count).toBe(1);
    } finally {
      deleteSpy.mockRestore();
    }

    // The swallowed failure doesn't mean the sweep never runs again — the
    // very next increment (with the mock restored) sweeps normally, proving
    // nothing about the sweep path itself was left broken by the failure
    // above, only that one call's failure didn't propagate.
    const staleWindow = new Date('2026-01-01T00:00:00Z');
    const freshWindow = new Date('2026-01-01T05:00:00Z');
    await incrementRateLimitCounter('test:stale-after-failed-sweep', staleWindow);
    await incrementRateLimitCounter('test:unrelated-after-failed-sweep', freshWindow);

    expect(await rowExists('test:stale-after-failed-sweep', staleWindow)).toBe(false);
  });
});
