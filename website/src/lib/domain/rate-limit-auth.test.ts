/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { rateLimitCounters } from '@/lib/db/schema';
import {
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  REGISTRATION_IP_LIMIT,
  REGISTRATION_SESSION_LIMIT,
  checkLoginRateLimit,
  checkRegistrationRateLimit,
} from './rate-limit';
import { generateGuestSessionId } from './session-id';
import { emailSchema } from '@/lib/contracts/auth';
import { resetDatabase, closePool } from '@/test/db-fixtures';

/**
 * KAN-20 — the registration and login caps. Same mechanism as KAN-25's
 * (`rate-limit.test.ts` carries the general cases); this file is what the
 * story's own numbers and its two-bucket-both-always-increment rule need.
 */
const NOW = new Date('2026-01-01T12:00:00Z');

async function counters(): Promise<Map<string, number>> {
  const rows = await db.select().from(rateLimitCounters);
  return new Map(rows.map((row) => [row.bucketKey, row.count]));
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const email = (raw: string) => emailSchema.parse(raw);

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closePool();
});

describe('registration — 10 per IP per hour, plus 5 per presented guest-cookie value per hour', () => {
  it.skipIf(process.env.RATE_LIMIT_REGISTRATION_SESSION_LIMIT !== undefined)('the per-cookie cap defaults to exactly five — BR-1.8\'s per-session allowance, not a number re-derived from the module', () => {
    expect(REGISTRATION_SESSION_LIMIT).toBe(5);
  });

  it.skipIf(process.env.RATE_LIMIT_REGISTRATION_IP_LIMIT !== undefined)('the per-IP cap defaults to exactly ten', () => {
    expect(REGISTRATION_IP_LIMIT).toBe(10);
  });

  it('allows the per-cookie cap of attempts on one guest cookie and refuses the next, even from a different address each time', async () => {
    const guest = generateGuestSessionId();
    const results: boolean[] = [];
    for (let i = 0; i < REGISTRATION_SESSION_LIMIT + 1; i++) {
      results.push(await checkRegistrationRateLimit(guest, `192.0.2.${i}`, NOW));
    }
    expect(results).toEqual([...Array<boolean>(REGISTRATION_SESSION_LIMIT).fill(true), false]);
  });

  it('allows the IP cap and refuses the next, with no guest cookie at all', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < REGISTRATION_IP_LIMIT + 1; i++) {
      results.push(await checkRegistrationRateLimit(null, '192.0.2.1', NOW));
    }
    expect(results.slice(0, REGISTRATION_IP_LIMIT).every(Boolean)).toBe(true);
    expect(results[REGISTRATION_IP_LIMIT]).toBe(false);
  });

  it('a request with no guest cookie writes no per-cookie bucket — only the IP one', async () => {
    await checkRegistrationRateLimit(null, '192.0.2.1', NOW);

    expect([...(await counters()).keys()]).toEqual(['registration:ip:192.0.2.1']);
  });

  it('BOTH counters increment on a refusal: a request refused by the cookie cap still counts against the address', async () => {
    const guest = generateGuestSessionId();
    for (let i = 0; i < REGISTRATION_SESSION_LIMIT; i++) await checkRegistrationRateLimit(guest, null, NOW);

    const refused = await checkRegistrationRateLimit(guest, '192.0.2.9', NOW);

    expect(refused).toBe(false);
    expect((await counters()).get('registration:ip:192.0.2.9')).toBe(1);
  });

  it('BOTH counters increment on a refusal: a request refused by the IP cap still counts against the guest cookie', async () => {
    for (let i = 0; i < REGISTRATION_IP_LIMIT; i++) await checkRegistrationRateLimit(null, '192.0.2.9', NOW);
    const guest = generateGuestSessionId();

    const refused = await checkRegistrationRateLimit(guest, '192.0.2.9', NOW);

    expect(refused).toBe(false);
    expect((await counters()).get(`registration:session:${guest}`)).toBe(1);
  });
});

describe('login — two buckets, 30 per IP and 10 per email per hour, both always checked', () => {
  it('the per-email cap is exactly ten — the ruled number', () => {
    expect(LOGIN_EMAIL_LIMIT).toBe(10);
  });

  it.skipIf(process.env.RATE_LIMIT_LOGIN_IP_LIMIT !== undefined)('the per-IP cap defaults to exactly thirty', () => {
    expect(LOGIN_IP_LIMIT).toBe(30);
  });

  it('stops ONE account being stuffed from many addresses: the eleventh attempt is refused although every address is well under its own cap', async () => {
    const target = email('victim@example.test');
    const results: boolean[] = [];
    for (let i = 0; i < LOGIN_EMAIL_LIMIT + 1; i++) {
      results.push(await checkLoginRateLimit(target, `198.51.100.${i}`, NOW));
    }
    expect(results.slice(0, LOGIN_EMAIL_LIMIT).every(Boolean)).toBe(true);
    expect(results[LOGIN_EMAIL_LIMIT]).toBe(false);
  });

  it('stops ONE host spraying many accounts: the attempt after the IP cap is refused although every account is untouched', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < LOGIN_IP_LIMIT + 1; i++) {
      results.push(await checkLoginRateLimit(email(`account-${i}@example.test`), '203.0.113.7', NOW));
    }
    expect(results.slice(0, LOGIN_IP_LIMIT).every(Boolean)).toBe(true);
    expect(results[LOGIN_IP_LIMIT]).toBe(false);
  });

  describe('neither bucket short-circuits', () => {
    it('a request refused by the EMAIL bucket still increments the IP bucket', async () => {
      const target = email('victim@example.test');
      for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(target, null, NOW);

      const allowed = await checkLoginRateLimit(target, '203.0.113.7', NOW);

      expect(allowed).toBe(false);
      expect((await counters()).get('login:ip:203.0.113.7')).toBe(1);
    });

    it('a request refused by the IP bucket still increments the EMAIL bucket', async () => {
      for (let i = 0; i < LOGIN_IP_LIMIT; i++) await checkLoginRateLimit(email(`filler-${i}@example.test`), '203.0.113.7', NOW);
      const target = email('victim@example.test');

      const allowed = await checkLoginRateLimit(target, '203.0.113.7', NOW);

      expect(allowed).toBe(false);
      expect((await counters()).get(`login:email:${sha256('victim@example.test')}`)).toBe(1);
    });

    it('a request refused by BOTH increments both', async () => {
      const target = email('victim@example.test');
      for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(target, null, NOW);
      for (let i = 0; i < LOGIN_IP_LIMIT; i++) await checkLoginRateLimit(email(`filler-${i}@example.test`), '203.0.113.7', NOW);
      const before = await counters();

      await checkLoginRateLimit(target, '203.0.113.7', NOW);

      const after = await counters();
      expect(after.get('login:ip:203.0.113.7')).toBe((before.get('login:ip:203.0.113.7') ?? 0) + 1);
      expect(after.get(`login:email:${sha256('victim@example.test')}`)).toBe((before.get(`login:email:${sha256('victim@example.test')}`) ?? 0) + 1);
    });

    it('a request under both caps increments both', async () => {
      await checkLoginRateLimit(email('a@example.test'), '203.0.113.7', NOW);

      const seen = await counters();
      expect(seen.get('login:ip:203.0.113.7')).toBe(1);
      expect(seen.get(`login:email:${sha256('a@example.test')}`)).toBe(1);
    });
  });

  describe('the email bucket key', () => {
    it('is the FULL SHA-256 hex of the normalised email: 64 hex characters, checked against an independent computation', async () => {
      await checkLoginRateLimit(email('Someone@Example.TEST'), null, NOW);

      const keys = [...(await counters()).keys()];
      expect(keys).toEqual([`login:email:${sha256('someone@example.test')}`]);
      expect(keys[0].slice('login:email:'.length)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is not the 12-hex truncation hashAndTruncate produces — a 48-bit hash of a guessable value is recoverable', async () => {
      await checkLoginRateLimit(email('someone@example.test'), null, NOW);

      const [key] = [...(await counters()).keys()];
      expect(key).not.toContain(sha256('someone@example.test').slice(0, 12) + ':');
      expect(key.length).toBe('login:email:'.length + 64);
    });

    it('never contains the raw email or its local part', async () => {
      await checkLoginRateLimit(email('someone@example.test'), '203.0.113.7', NOW);

      for (const key of (await counters()).keys()) {
        expect(key).not.toContain('someone');
        expect(key).not.toContain('example.test');
      }
    });

    it('is the same bucket however the address was typed, because the brand forces normalisation first', async () => {
      await checkLoginRateLimit(email('  Someone@EXAMPLE.test '), null, NOW);
      await checkLoginRateLimit(email('someone@example.test'), null, NOW);

      const seen = await counters();
      expect(seen.size).toBe(1);
      expect([...seen.values()]).toEqual([2]);
    });

    it('differs between different emails', async () => {
      await checkLoginRateLimit(email('a@example.test'), null, NOW);
      await checkLoginRateLimit(email('b@example.test'), null, NOW);

      expect((await counters()).size).toBe(2);
    });
  });

  describe('refusal logging never carries an email or anything derived from one', () => {
    it('an email-scoped refusal logs the cap that fired and NO identity — not the email, not its hash, not a truncation of it', async () => {
      const target = email('victim@example.test');
      for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(target, null, NOW);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checkLoginRateLimit(target, null, NOW);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [line] = logSpy.mock.calls[0] as [string];
      expect(JSON.parse(line)).toMatchObject({
        severity: 'WARNING',
        event: 'rate_limit_refused',
        action: 'login',
        scope: 'email',
        limit: LOGIN_EMAIL_LIMIT,
        count: LOGIN_EMAIL_LIMIT + 1,
        identityHash: null,
      });
      const full = sha256('victim@example.test');
      expect(line).not.toContain('victim');
      expect(line).not.toContain('example.test');
      expect(line).not.toContain(full);
      expect(line).not.toContain(full.slice(0, 12));
      // The double hash hashAndTruncate WOULD have produced is absent too.
      expect(line).not.toContain(sha256(full).slice(0, 12));
    });
  });

  it('with no client address, the IP bucket is skipped (the KAN-25 behaviour) and the email bucket alone applies', async () => {
    await checkLoginRateLimit(email('a@example.test'), null, NOW);

    expect([...(await counters()).keys()]).toEqual([`login:email:${sha256('a@example.test')}`]);
  });
});
