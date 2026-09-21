/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  // Round-1 review (Test Lead, blocking): every other test in this file
  // reads the limit off the module under test (`ESSAY_SUBMISSION_SESSION_LIMIT`),
  // which is correct for keeping tests and code in lock-step but means the
  // ticket's actual number — five — was asserted nowhere. A refactor that
  // changed the constant's value would still pass every test below it,
  // silently shipping a different cap than the one the ticket fixed. This
  // is the one place that number is pinned, stated once, against the
  // ticket's own acceptance criterion rather than re-derived from the code
  // it's meant to be checking.
  it('the session cap is exactly five per hour — the ticket\'s own number, not a value re-derived from the module under test', () => {
    expect(ESSAY_SUBMISSION_SESSION_LIMIT).toBe(5);
  });

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

  // Round-1 review (Test Lead, blocking): the window length itself was
  // never pinned either — the old version of this test exhausted the cap at
  // :30 past the hour and checked again an hour later, which only proves
  // the window is SHORTER than that hour-long gap; any window from a few
  // seconds upward would still pass it. Replaced with the two edge cases
  // that actually pin the boundary: exhausting at the top of an hour and
  // checking one millisecond before it ends (still refused — the window is
  // not shorter than an hour), and exhausting one millisecond before an
  // hour ends and checking the very next millisecond (allowed — the window
  // is not longer than an hour either). Together the two pin the window at
  // exactly one hour; a refactor of `windowStartFor`'s arithmetic, or an
  // edit to either window constant, now fails one of them.
  it('exhausted at the top of an hour, a request one millisecond before that hour ends is still refused — the window is not shorter than an hour', async () => {
    const sessionId = generateGuestSessionId();
    const topOfHour = new Date('2026-01-01T05:00:00.000Z');
    const oneMsBeforeHourEnds = new Date('2026-01-01T05:59:59.999Z');

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const ok = await checkEssaySubmissionRateLimit(sessionId, `203.0.113.${i}`, topOfHour);
      expect(ok).toBe(true); // see the boundary test's own comment above
    }
    const stillRefused = await checkEssaySubmissionRateLimit(sessionId, '203.0.113.99', oneMsBeforeHourEnds);

    expect(stillRefused).toBe(false);
  });

  it('exhausted one millisecond before an hour ends, the very next millisecond is allowed — the window is not longer than an hour either', async () => {
    const sessionId = generateGuestSessionId();
    const oneMsBeforeHourEnds = new Date('2026-01-01T05:59:59.999Z');
    const nextMs = new Date('2026-01-01T06:00:00.000Z');

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const ok = await checkEssaySubmissionRateLimit(sessionId, `203.0.113.${i}`, oneMsBeforeHourEnds);
      expect(ok).toBe(true); // see the boundary test's own comment above
    }
    const allowedInNewWindow = await checkEssaySubmissionRateLimit(sessionId, '203.0.113.99', nextMs);

    expect(allowedInNewWindow).toBe(true);
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

  // Round-1 review (Test Lead, blocking): same gap as the essay endpoint's
  // session cap above, and the same fix — see that describe block's own
  // comment for the full reasoning. This endpoint shares `windowStartFor`
  // with the essay endpoint, but a refactor scoped to only ONE of the two
  // window constants (`ESSAY_SUBMISSION_SESSION_WINDOW_MS` vs.
  // `GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS`) would only be caught here.
  it('exhausted at the top of an hour, a request one millisecond before that hour ends is still refused — the window is not shorter than an hour', async () => {
    const sessionId = generateGuestSessionId();
    const topOfHour = new Date('2026-01-01T05:00:00.000Z');
    const oneMsBeforeHourEnds = new Date('2026-01-01T05:59:59.999Z');

    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      const ok = await checkGuestSessionResolveRateLimit(sessionId, `198.18.1.${i % 255}`, topOfHour);
      expect(ok).toBe(true); // see the boundary test's own comment above
    }
    const stillRefused = await checkGuestSessionResolveRateLimit(sessionId, '198.18.1.200', oneMsBeforeHourEnds);

    expect(stillRefused).toBe(false);
  });

  it('exhausted one millisecond before an hour ends, the very next millisecond is allowed — the window is not longer than an hour either', async () => {
    const sessionId = generateGuestSessionId();
    const oneMsBeforeHourEnds = new Date('2026-01-01T05:59:59.999Z');
    const nextMs = new Date('2026-01-01T06:00:00.000Z');

    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      const ok = await checkGuestSessionResolveRateLimit(sessionId, `198.18.1.${i % 255}`, oneMsBeforeHourEnds);
      expect(ok).toBe(true); // see the boundary test's own comment above
    }
    const allowedInNewWindow = await checkGuestSessionResolveRateLimit(sessionId, '198.18.1.200', nextMs);

    expect(allowedInNewWindow).toBe(true);
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

describe('rate-limit refusal logging (KAN-25 item 5, round-1 review, blocking — the one line this story emits, since no traffic baseline exists to validate either cap against otherwise)', () => {
  it('logs nothing while every cap is still under its limit', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await checkEssaySubmissionRateLimit(generateGuestSessionId(), '192.0.2.10', FIXED_NOW);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs one structured line naming the session cap and its count when it fires, and never contains the raw session id', async () => {
    const sessionId = generateGuestSessionId();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
        await checkEssaySubmissionRateLimit(sessionId, null, FIXED_NOW);
      }
      logSpy.mockClear();

      await checkEssaySubmissionRateLimit(sessionId, null, FIXED_NOW);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [line] = logSpy.mock.calls[0] as [string];
      const logged: unknown = JSON.parse(line);
      expect(logged).toMatchObject({
        action: 'essaySubmission',
        scope: 'session',
        limit: ESSAY_SUBMISSION_SESSION_LIMIT,
        count: ESSAY_SUBMISSION_SESSION_LIMIT + 1,
      });
      // The bearer credential itself must never appear in the log line, in
      // any form — see logRefusal's own comment for why a session-scoped
      // refusal carries no identity field at all, unlike an IP-scoped one.
      expect(line).not.toContain(sessionId);
      expect(logged).not.toHaveProperty('identityHash');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs the IP cap by scope, with a hashed/truncated address, never the raw one', async () => {
    const ip = '192.0.2.222';
    const sessionsNeeded = Math.ceil(ESSAY_SUBMISSION_IP_LIMIT / ESSAY_SUBMISSION_SESSION_LIMIT);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      let submissionsSoFar = 0;
      for (let s = 0; s < sessionsNeeded && submissionsSoFar < ESSAY_SUBMISSION_IP_LIMIT; s++) {
        const sid = generateGuestSessionId();
        for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT && submissionsSoFar < ESSAY_SUBMISSION_IP_LIMIT; i++) {
          await checkEssaySubmissionRateLimit(sid, ip, FIXED_NOW);
          submissionsSoFar++;
        }
      }
      logSpy.mockClear();

      await checkEssaySubmissionRateLimit(generateGuestSessionId(), ip, FIXED_NOW);

      const ipLogLine = logSpy.mock.calls.map((call) => call[0] as string).find((line) => JSON.parse(line).scope === 'ip');
      expect(ipLogLine).toBeDefined();
      const ipLog: unknown = JSON.parse(ipLogLine as string);
      expect(ipLog).toMatchObject({ action: 'essaySubmission', scope: 'ip', limit: ESSAY_SUBMISSION_IP_LIMIT });
      expect((ipLog as { identityHash?: string }).identityHash).toBeTruthy();
      expect(ipLogLine).not.toContain(ip);
    } finally {
      logSpy.mockRestore();
    }
  });
});
