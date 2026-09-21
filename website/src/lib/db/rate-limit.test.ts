/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { incrementRateLimitCounter } from './rate-limit';
import { resetDatabase, closePool } from '@/test/db-fixtures';

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
