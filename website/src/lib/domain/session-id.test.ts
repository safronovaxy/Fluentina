/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { generateGuestSessionId } from './session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';

describe('generateGuestSessionId', () => {
  it('produces a 32-character lowercase hex string — 128 bits, matching the contract schema', () => {
    const id = generateGuestSessionId();

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(() => guestSessionIdSchema.parse(id)).not.toThrow();
  });

  it('is not sequential and does not repeat across many calls', () => {
    const ids = Array.from({ length: 1000 }, () => generateGuestSessionId());

    // A CSPRNG source makes a collision in 1000 128-bit draws astronomically
    // unlikely; a sequential or time-derived generator would not pass this.
    expect(new Set(ids).size).toBe(ids.length);

    // Consecutive ids from a sequential/counter-based generator would share
    // a long common prefix or move by a fixed step; neither should hold here.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).not.toBe(ids[i - 1]);
      expect(ids[i].slice(0, 8)).not.toBe(ids[i - 1].slice(0, 8));
    }
  });
});
