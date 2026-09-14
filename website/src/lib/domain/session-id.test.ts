/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { generateGuestSessionId } from './session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';

describe('generateGuestSessionId', () => {
  it('draws its entropy from the Web Crypto global, not node:crypto — the source src/middleware.ts (Edge runtime) can also call', () => {
    // The whole reason for this generator to exist on the Web Crypto API
    // rather than node:crypto is that KAN-10's issuance middleware runs at
    // the edge, where node:crypto isn't available. Spying on the global
    // proves the implementation actually draws from it rather than merely
    // claiming to in a comment — a regression back to node:crypto would
    // leave this spy uncalled while every other assertion in this file
    // still passed.
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    generateGuestSessionId();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('hex-encodes getRandomValues\' own output byte for byte — not merely a value from some other source called alongside it', () => {
    // The spy test above proves the function was CALLED; it does not prove
    // the returned id is actually DERIVED from what it returned. A
    // regression that kept the call but built the id from a different
    // source instead — e.g. `crypto.randomUUID()`, which this file's own
    // comment rejects for spending 6 of its 128 bits on version/variant
    // markers (122 bits of real entropy, not the 128 this story specifies)
    // — would leave that spy satisfied while quietly narrowing the id
    // space. Stubbing getRandomValues with a known byte pattern and
    // asserting the exact resulting string is what closes that gap.
    const knownBytes = Uint8Array.from({ length: 16 }, (_, i) => i);
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
      array.set(knownBytes);
      return array;
    }) as typeof crypto.getRandomValues);

    const id = generateGuestSessionId();

    expect(id).toBe('000102030405060708090a0b0c0d0e0f');
    spy.mockRestore();
  });

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
