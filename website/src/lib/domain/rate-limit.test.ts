/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  checkEssaySubmissionRateLimit,
  checkGuestSessionResolveRateLimit,
  ESSAY_SUBMISSION_SESSION_LIMIT,
  ESSAY_SUBMISSION_IP_LIMIT,
  GUEST_SESSION_RESOLVE_SESSION_LIMIT,
  GUEST_SESSION_RESOLVE_IP_LIMIT,
} from './rate-limit';
import { generateGuestSessionId } from './session-id';
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

const FIXED_NOW = new Date('2026-01-01T12:00:00Z');

describe('checkEssaySubmissionRateLimit — the session cap (5/hour, fixed by the ticket)', () => {
  it('allows exactly the limit — the boundary itself is not blocked', async () => {
    const sessionId = generateGuestSessionId();

    const results: boolean[] = [];
    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      results.push(await checkEssaySubmissionRateLimit(sessionId, `192.0.2.${i}`, FIXED_NOW));
    }

    // Assert every one of the five actually succeeded — the trap the ticket
    // itself names: a test proving the sixth is refused is worthless if any
    // of the first five failed for an unrelated reason, since the counter
    // would never have reached the limit and the sixth would be refused for
    // the wrong reason.
    expect(results).toEqual(Array(ESSAY_SUBMISSION_SESSION_LIMIT).fill(true));
  });

  it('blocks the request one past the limit, for the same session, even from a fresh IP each time', async () => {
    const sessionId = generateGuestSessionId();

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const ok = await checkEssaySubmissionRateLimit(sessionId, `192.0.2.${i}`, FIXED_NOW);
      expect(ok).toBe(true); // see the boundary test's own comment above
    }

    const sixth = await checkEssaySubmissionRateLimit(sessionId, '192.0.2.99', FIXED_NOW);

    expect(sixth).toBe(false);
  });

  it('does not let one session\'s cap affect a different session — the counter is scoped per session, not global', async () => {
    const exhaustedSession = generateGuestSessionId();
    const freshSession = generateGuestSessionId();

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      await checkEssaySubmissionRateLimit(exhaustedSession, '198.51.100.1', FIXED_NOW);
    }
    const exhaustedResult = await checkEssaySubmissionRateLimit(exhaustedSession, '198.51.100.1', FIXED_NOW);
    const freshResult = await checkEssaySubmissionRateLimit(freshSession, '198.51.100.2', FIXED_NOW);

    expect(exhaustedResult).toBe(false);
    expect(freshResult).toBe(true);
  });

  it('resets once a new fixed window starts — a session capped in one hour is allowed again in the next', async () => {
    const sessionId = generateGuestSessionId();
    const firstWindow = new Date('2026-01-01T00:30:00Z');
    const secondWindow = new Date('2026-01-01T01:30:00Z');

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      await checkEssaySubmissionRateLimit(sessionId, `203.0.113.${i}`, firstWindow);
    }
    const stillInFirstWindow = await checkEssaySubmissionRateLimit(sessionId, '203.0.113.99', firstWindow);
    const inNextWindow = await checkEssaySubmissionRateLimit(sessionId, '203.0.113.99', secondWindow);

    expect(stillInFirstWindow).toBe(false);
    expect(inNextWindow).toBe(true);
  });
});

describe('checkEssaySubmissionRateLimit — the per-IP backstop, deliberately looser than the session cap (KAN-25\'s own engineering call)', () => {
  it('the IP backstop is strictly looser than the session cap, the acceptance criterion\'s own "shared network" requirement made concrete', () => {
    expect(ESSAY_SUBMISSION_IP_LIMIT).toBeGreaterThan(ESSAY_SUBMISSION_SESSION_LIMIT);
  });

  // The AC this test exists to prove: the session cap ALONE is trivially
  // bypassable by clearing the session cookie (a fresh session id resets
  // the session-scoped counter to zero) — the per-IP backstop is what stops
  // that from being a free pass to unlimited submissions, because it stays
  // keyed on the one thing that doesn't change when the cookie does: the
  // caller's IP. Enough distinct sessions are used here, each comfortably
  // under ITS OWN session cap, that only the shared IP identity can be
  // responsible for the final rejection.
  it('blocks a request from the same IP even under a session that has never submitted before, once the IP backstop is exhausted — not bypassable by clearing the session cookie', async () => {
    const sharedIp = '192.0.2.50';
    const sessionsNeeded = Math.ceil(ESSAY_SUBMISSION_IP_LIMIT / ESSAY_SUBMISSION_SESSION_LIMIT);

    let ipExhaustingResult = true;
    let submissionsSoFar = 0;
    for (let s = 0; s < sessionsNeeded && submissionsSoFar < ESSAY_SUBMISSION_IP_LIMIT; s++) {
      const sessionId = generateGuestSessionId();
      for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT && submissionsSoFar < ESSAY_SUBMISSION_IP_LIMIT; i++) {
        ipExhaustingResult = await checkEssaySubmissionRateLimit(sessionId, sharedIp, FIXED_NOW);
        submissionsSoFar++;
      }
    }
    // Every one of the calls that actually reached ESSAY_SUBMISSION_IP_LIMIT
    // total submissions must have succeeded — proves the loop above reached
    // the boundary for the right reason (each session's own cap never
    // fired) before the assertion below checks what happens one past it.
    expect(ipExhaustingResult).toBe(true);
    expect(submissionsSoFar).toBe(ESSAY_SUBMISSION_IP_LIMIT);

    const brandNewSession = generateGuestSessionId(); // never submitted before — its OWN cap is nowhere near exhausted
    const result = await checkEssaySubmissionRateLimit(brandNewSession, sharedIp, FIXED_NOW);

    expect(result).toBe(false);
  });

  it('does not let one IP\'s cap affect a different IP', async () => {
    const exhaustedIp = '192.0.2.60';
    for (let i = 0; i < ESSAY_SUBMISSION_IP_LIMIT; i++) {
      await checkEssaySubmissionRateLimit(generateGuestSessionId(), exhaustedIp, FIXED_NOW);
    }
    const exhaustedResult = await checkEssaySubmissionRateLimit(generateGuestSessionId(), exhaustedIp, FIXED_NOW);
    const freshIpResult = await checkEssaySubmissionRateLimit(generateGuestSessionId(), '192.0.2.61', FIXED_NOW);

    expect(exhaustedResult).toBe(false);
    expect(freshIpResult).toBe(true);
  });

  // Round-1 (self-caught, verified against the real e2e pipeline): `ip:
  // null` (`clientIp`'s own reading of a request with no `X-Forwarded-For`
  // at all — never expected for real production traffic behind the load
  // balancer, always true for a direct, no-proxy test run) must skip the
  // IP-scoped check entirely, not apply it against some shared placeholder
  // identity — a shared bucket let one such caller's requests exhaust the
  // budget for every OTHER caller sharing it, observed directly as
  // unrelated e2e specs failing with real 429s. The session cap still
  // applies regardless — this only widens what the IP backstop alone would
  // have blocked.
  it('skips the IP-scoped check entirely when ip is null — the session cap alone still applies', async () => {
    const sessionId = generateGuestSessionId();

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const ok = await checkEssaySubmissionRateLimit(sessionId, null, FIXED_NOW);
      expect(ok).toBe(true);
    }
    const sixth = await checkEssaySubmissionRateLimit(sessionId, null, FIXED_NOW);
    expect(sixth).toBe(false); // the session cap, not skipped, still bites

    // A different session, also presenting no IP at all, is completely
    // unaffected by the first session having exhausted ITS cap — proves
    // there is no shared bucket underneath `null` for the two to collide on.
    const freshSession = generateGuestSessionId();
    const freshResult = await checkEssaySubmissionRateLimit(freshSession, null, FIXED_NOW);
    expect(freshResult).toBe(true);
  });
});

describe('checkGuestSessionResolveRateLimit — the accumulated-finding fix: bounding the converted-session remint loop', () => {
  it('allows exactly the session-scoped limit for one repeatedly-presented raw cookie value, then blocks the next', async () => {
    // The exact shape the accumulated finding describes: a client that keeps
    // presenting the SAME raw (e.g. converted/unavailable) session id on
    // every call — resolveGuestSession mints a different actual session
    // under the hood each time, but this function counts against the raw
    // presented value, which stays constant across the loop.
    const repeatedlyPresentedRawId = generateGuestSessionId();

    const results: boolean[] = [];
    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      results.push(await checkGuestSessionResolveRateLimit(repeatedlyPresentedRawId, `198.18.0.${i % 255}`, FIXED_NOW));
    }
    expect(results).toEqual(Array(GUEST_SESSION_RESOLVE_SESSION_LIMIT).fill(true));

    const oneMore = await checkGuestSessionResolveRateLimit(repeatedlyPresentedRawId, '198.18.0.200', FIXED_NOW);

    expect(oneMore).toBe(false);
  });

  it('the IP backstop is looser than the essay endpoint\'s, matching this endpoint\'s lower per-request cost', () => {
    expect(GUEST_SESSION_RESOLVE_IP_LIMIT).toBeGreaterThan(ESSAY_SUBMISSION_IP_LIMIT);
  });

  it('the two actions (essay submission, guest-session resolve) are counted independently — exhausting one leaves the other alone for the same session and IP', async () => {
    const sessionId = generateGuestSessionId();
    const ip = '192.0.2.77';

    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      await checkGuestSessionResolveRateLimit(sessionId, ip, FIXED_NOW);
    }
    const guestSessionExhausted = await checkGuestSessionResolveRateLimit(sessionId, ip, FIXED_NOW);
    const essaySubmissionStillFresh = await checkEssaySubmissionRateLimit(sessionId, ip, FIXED_NOW);

    expect(guestSessionExhausted).toBe(false);
    expect(essaySubmissionStillFresh).toBe(true);
  });
});
