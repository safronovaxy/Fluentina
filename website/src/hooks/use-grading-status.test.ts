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
  report: null,
  failureReason: null,
  jobAgeMs,
});

// KAN-17: the slow state and the stalled state must partition an unfinished
// job's life — slow between the two bounds, stalled after — so a job is
// never both, and there is no gap in which the screen says nothing new.
// `isSlow` takes the MONOTONIC elapsed age (`usePendingElapsed`), separately
// from the status: `isStalled` reads the raw `jobAgeMs` of the last answer.
describe('isSlow', () => {
  it.each(['pending', 'processing'] as const)('is false for a %s job at or under the slow mark', (status) => {
    expect(isSlow(unfinished(status, 0), 0)).toBe(false);
    expect(isSlow(unfinished(status, GRADING_SLOW_AFTER_MS), GRADING_SLOW_AFTER_MS)).toBe(false);
  });

  it.each(['pending', 'processing'] as const)('is true for a %s job past the slow mark and inside the poll bound', (status) => {
    expect(isSlow(unfinished(status, GRADING_SLOW_AFTER_MS + 1), GRADING_SLOW_AFTER_MS + 1)).toBe(true);
    expect(isSlow(unfinished(status, GRADING_POLL_MAX_AGE_MS), GRADING_POLL_MAX_AGE_MS)).toBe(true);
  });

  it('is decided from the elapsed age it is given, not the last answer\'s raw age — so an answer that steps back does not unlatch it', () => {
    // The last answer says 59.8s; the monotonic clock has already shown 60.4s.
    expect(isSlow(unfinished('pending', GRADING_SLOW_AFTER_MS - 200), GRADING_SLOW_AFTER_MS + 400)).toBe(true);
  });

  it('is false once the poll bound is passed — that job is stalled, not slow, even if the elapsed age alone would say slow', () => {
    const job = unfinished('pending', GRADING_POLL_MAX_AGE_MS + 1);
    expect(isStalled(job)).toBe(true);
    expect(isSlow(job, GRADING_POLL_MAX_AGE_MS + 1)).toBe(false);
    expect(isSlow(job, GRADING_SLOW_AFTER_MS + 1)).toBe(false);
  });

  it('is never true for a finished job, however old', () => {
    for (const status of ['succeeded', 'failed'] as const) {
      const job = { status, report: null, failureReason: null, jobAgeMs: GRADING_SLOW_AFTER_MS + 1 };
      expect(isSlow(job, GRADING_SLOW_AFTER_MS + 1)).toBe(false);
    }
  });

  it('is false when the elapsed age is unknown, and before there is any answer', () => {
    expect(isSlow(unfinished('pending', null), null)).toBe(false);
    expect(isSlow(unfinished('pending', GRADING_SLOW_AFTER_MS + 1), null)).toBe(false);
    expect(isSlow(undefined, GRADING_SLOW_AFTER_MS + 1)).toBe(false);
  });
});
