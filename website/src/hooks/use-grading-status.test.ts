import { describe, expect, it } from 'vitest';
import {
  GRADING_POLL_MAX_AGE_MS,
  GRADING_SLOW_AFTER_MS,
  isSlow,
  isStalled,
  type GradingStatus,
} from './use-grading-status';

const unfinished = (status: 'pending' | 'processing', jobAgeMs: number | null): GradingStatus => ({
  status,
  result: null,
  failureReason: null,
  jobAgeMs,
});

// KAN-17: the slow state and the stalled state must partition an unfinished
// job's life — slow between the two bounds, stalled after — so a job is
// never both, and there is no gap in which the screen says nothing new.
describe('isSlow', () => {
  it.each(['pending', 'processing'] as const)('is false for a %s job at or under the slow mark', (status) => {
    expect(isSlow(unfinished(status, 0))).toBe(false);
    expect(isSlow(unfinished(status, GRADING_SLOW_AFTER_MS))).toBe(false);
  });

  it.each(['pending', 'processing'] as const)('is true for a %s job past the slow mark and inside the poll bound', (status) => {
    expect(isSlow(unfinished(status, GRADING_SLOW_AFTER_MS + 1))).toBe(true);
    expect(isSlow(unfinished(status, GRADING_POLL_MAX_AGE_MS))).toBe(true);
  });

  it('is false once the poll bound is passed — that job is stalled, not slow', () => {
    const job = unfinished('pending', GRADING_POLL_MAX_AGE_MS + 1);
    expect(isStalled(job)).toBe(true);
    expect(isSlow(job)).toBe(false);
  });

  it('is never true for a finished job, however old', () => {
    for (const status of ['succeeded', 'failed'] as const) {
      expect(isSlow({ status, result: null, failureReason: null, jobAgeMs: GRADING_SLOW_AFTER_MS + 1 })).toBe(false);
    }
  });

  it('is false when the age is unknown, and before there is any answer', () => {
    expect(isSlow(unfinished('pending', null))).toBe(false);
    expect(isSlow(undefined)).toBe(false);
  });
});
