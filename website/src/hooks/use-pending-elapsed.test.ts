import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { advanceElapsed, usePendingElapsed } from './use-pending-elapsed';

// KAN-17: the pending screen's clock, and the slow state derived from it,
// must never step back — the raw age from a poll can (whole-second `Date`
// header, instances whose clocks differ), and a step back would re-announce.
describe('advanceElapsed', () => {
  it('carries the reported age forward by the client clock\'s difference since the answer', () => {
    expect(advanceElapsed(0, 10_000, 1_000_000, 1_004_000)).toBe(14_000);
  });

  it('never goes below the floor: an answer that reports a younger job than already shown does not rewind it', () => {
    // 60.4s already shown; the next answer says 59.8s and arrived just now.
    expect(advanceElapsed(60_400, 59_800, 2_000_000, 2_000_000)).toBe(60_400);
  });

  it('rises again once the extrapolation passes the floor', () => {
    expect(advanceElapsed(60_400, 59_800, 2_000_000, 2_001_000)).toBe(60_800);
  });

  it('never subtracts: a `now` from before the answer (a stale tick) counts as zero elapsed since it', () => {
    expect(advanceElapsed(0, 10_000, 1_002_000, 1_000_000)).toBe(10_000);
  });

  it('is monotonic over any sequence of answers and ticks', () => {
    let floor = 0;
    const seen: number[] = [];
    // (age reported, answered at, now) — ages deliberately jump around.
    for (const [age, answeredAt, now] of [
      [65_000, 0, 0], [50_000, 2_500, 2_500], [50_000, 2_500, 3_500], [70_000, 5_000, 5_000], [40_000, 7_500, 7_500],
    ]) {
      floor = advanceElapsed(floor, age, answeredAt, now);
      seen.push(floor);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe('usePendingElapsed', () => {
  afterEach(() => vi.useRealTimers());

  it('is null until an answer with an age has arrived', () => {
    const { result } = renderHook(() => usePendingElapsed('essay-1', null, 0));
    expect(result.current).toBeNull();
  });

  it('ticks once a second while there is an age, and stops once there is none (a finished job)', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { result, rerender } = renderHook(({ age }) => usePendingElapsed('essay-1', age, start), { initialProps: { age: 5_000 as number | null } });
    expect(result.current).toBe(5_000);

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(8_000);

    rerender({ age: null });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the floor when a later answer reports a younger job', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { result, rerender } = renderHook(
      ({ age, answeredAt }) => usePendingElapsed('essay-1', age, answeredAt),
      { initialProps: { age: 60_400, answeredAt: start } },
    );
    expect(result.current).toBe(60_400);

    rerender({ age: 59_800, answeredAt: start });
    expect(result.current).toBe(60_400);
  });

  it('does not carry one essay\'s elapsed time over to the next', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { result, rerender } = renderHook(
      ({ essayId, age }) => usePendingElapsed(essayId, age, start),
      { initialProps: { essayId: 'essay-1', age: 90_000 } },
    );
    expect(result.current).toBe(90_000);

    rerender({ essayId: 'essay-2', age: 3_000 });
    expect(result.current).toBe(3_000);
  });
});
