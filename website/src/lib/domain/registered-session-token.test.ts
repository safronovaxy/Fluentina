import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { registeredSessionTokenHashSchema, registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { generateGuestSessionId } from './session-id';

describe('generateRegisteredSessionToken', () => {
  it('is 256 bits: 64 lowercase hex characters, double the guest id', () => {
    const token = generateRegisteredSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.length).toBe(generateGuestSessionId().length * 2);
  });

  it('never repeats across a large sample', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateRegisteredSessionToken()));
    expect(seen.size).toBe(2000);
  });

  it('draws every byte from the CSPRNG: no fixed bytes, so all 32 positions vary across samples', () => {
    const samples = Array.from({ length: 64 }, () => generateRegisteredSessionToken());
    for (let position = 0; position < 32; position++) {
      const bytesAtPosition = new Set(samples.map((s) => s.slice(position * 2, position * 2 + 2)));
      expect(bytesAtPosition.size, `byte ${position}`).toBeGreaterThan(1);
    }
  });

  it('produces a value the boundary schema accepts', () => {
    expect(registeredSessionTokenSchema.safeParse(generateRegisteredSessionToken()).success).toBe(true);
  });
});

describe('the token schema, at the cookie boundary', () => {
  it.each([
    ['a 32-character guest-shaped id', 'a'.repeat(32)],
    ['uppercase hex', 'A'.repeat(64)],
    ['non-hex', 'g'.repeat(64)],
    ['one character too long', 'a'.repeat(65)],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(registeredSessionTokenSchema.safeParse(value).success).toBe(false);
  });

  it('a guest session id is not a registered session token', () => {
    expect(registeredSessionTokenSchema.safeParse(generateGuestSessionId()).success).toBe(false);
  });
});

describe('hashRegisteredSessionToken — what sessions.id stores', () => {
  it('is plain SHA-256 hex of the token, checked against an independent computation', () => {
    const token = generateRegisteredSessionToken();
    expect(hashRegisteredSessionToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('matches a known SHA-256 vector (of the token as the cookie carries it, the 64-character hex text), so a "fixed" salted or KDF variant cannot slip in', () => {
    const token = registeredSessionTokenSchema.parse('00'.repeat(32));
    expect(hashRegisteredSessionToken(token)).toBe('60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
  });

  it('is deterministic — the same token always finds the same row — and never equals the token', () => {
    const token = generateRegisteredSessionToken();
    expect(hashRegisteredSessionToken(token)).toBe(hashRegisteredSessionToken(token));
    expect(hashRegisteredSessionToken(token)).not.toBe(token);
  });

  it('produces a value the hash schema accepts', () => {
    expect(registeredSessionTokenHashSchema.safeParse(hashRegisteredSessionToken(generateRegisteredSessionToken())).success).toBe(true);
  });
});
