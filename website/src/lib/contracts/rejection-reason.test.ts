import { describe, expect, it } from 'vitest';
import { GUARD_REJECTION_REASONS, REJECTION_REASONS, isRejectionReason } from './rejection-reason';
import { ESSAY_LENGTH_REJECTION_REASONS } from './essay-submission';

describe('rejection-reason — the KAN-31 union every first-party rejection draws its reason from', () => {
  it('is the guard reasons plus the two length reasons, with nothing missing and nothing duplicated', () => {
    expect(REJECTION_REASONS).toHaveLength(GUARD_REJECTION_REASONS.length + ESSAY_LENGTH_REJECTION_REASONS.length);
    expect(new Set(REJECTION_REASONS).size).toBe(REJECTION_REASONS.length);
    for (const reason of GUARD_REJECTION_REASONS) {
      expect(REJECTION_REASONS).toContain(reason);
    }
    for (const reason of ESSAY_LENGTH_REJECTION_REASONS) {
      expect(REJECTION_REASONS).toContain(reason);
    }
  });

  it.each(REJECTION_REASONS)('isRejectionReason recognises "%s"', (reason) => {
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
