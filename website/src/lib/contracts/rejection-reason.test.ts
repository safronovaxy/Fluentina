import { describe, expect, it } from 'vitest';
import { REJECTION_REASONS, isRejectionReason } from './rejection-reason';

/**
 * Round-1 review: the first two tests below used to be built from the
 * module's own source arrays (`GUARD_REJECTION_REASONS.length +
 * ESSAY_LENGTH_REJECTION_REASONS.length`, and `it.each(REJECTION_REASONS)`
 * iterating that same array) — every one of them held by construction, no
 * matter what the union actually contained, and only a rewrite of the
 * module itself could fail them. This literal list is the independent
 * check: pinned here, by hand, the same wire strings both route test
 * suites already pin individually — a reason silently renamed, dropped, or
 * added without updating this list now fails HERE, not just wherever a
 * route test happens to notice.
 */
const EXPECTED_REJECTION_REASONS = [
  'crossOrigin',
  'invalidSessionCookie',
  'bodyTooLarge',
  'invalidJson',
  'invalidSubmission',
  'tooShort',
  'tooLong',
] as const;

describe('rejection-reason — the KAN-31 union every first-party rejection draws its reason from', () => {
  it('is exactly this fixed set of seven reasons — nothing missing, nothing extra, nothing renamed', () => {
    expect([...REJECTION_REASONS].sort()).toEqual([...EXPECTED_REJECTION_REASONS].sort());
  });

  it.each(EXPECTED_REJECTION_REASONS)('isRejectionReason recognises "%s"', (reason) => {
    expect(isRejectionReason(reason)).toBe(true);
  });

  // Round-1-review-shaped guard, matching the exact class of bug
  // `essay-submission.ts`'s own history (KAN-15, round-2) already closed
  // once for the two length reasons: a value this union doesn't know about
  // must never narrow as if it were a real reason, on either side of the
  // wire.
  it('rejects a value that looks plausible but is not in the union — e.g. a rate-limit reason KAN-25 has not added yet', () => {
    expect(isRejectionReason('rateLimited')).toBe(false);
  });

  it('rejects non-string values, undefined, and null', () => {
    expect(isRejectionReason(undefined)).toBe(false);
    expect(isRejectionReason(null)).toBe(false);
    expect(isRejectionReason(42)).toBe(false);
    expect(isRejectionReason({ reason: 'tooShort' })).toBe(false);
  });
});
