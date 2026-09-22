/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkEssaySubmissionRateLimit,
  checkGuestSessionResolveRateLimit,
  ESSAY_SUBMISSION_SESSION_LIMIT,
  ESSAY_SUBMISSION_SESSION_WINDOW_MS,
  ESSAY_SUBMISSION_IP_LIMIT,
  ESSAY_SUBMISSION_IP_WINDOW_MS,
  GUEST_SESSION_RESOLVE_SESSION_LIMIT,
  GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS,
  GUEST_SESSION_RESOLVE_IP_LIMIT,
  GUEST_SESSION_RESOLVE_IP_WINDOW_MS,
  positiveIntEnv,
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

  // Round-2 review (Test Lead, blocking — measured directly): the claim
  // this comment used to make, that the two edge tests below "pin the
  // window at exactly one hour", was false. They pin it DOWNWARD only:
  // shortening the window still fails them (correct), but the Test Lead
  // measured that DOUBLING, TRIPLING, or even 6x-ing `ONE_HOUR_MS` survives
  // this whole file. The instant these tests use — 2026-01-01T05:00:00Z, the
  // fixed top-of-hour edge — is 490,902 hours since the epoch, which
  // divides evenly by 2, 3 and 6; at any of those widened windows the first
  // edge below still falls inside one bucket and the second is still a
  // bucket start, so both assertions still hold by coincidence of the
  // chosen instant, not because the window is actually one hour. A constant
  // doubled in some future refactor would enforce five submissions per TWO
  // hours, ship with a green suite, and this very comment claiming it
  // couldn't happen. The direct assertion right below closes that: it pins
  // the constant itself against the ticket's literal "an hour", independent
  // of which instant any other test happens to use. These two edge tests
  // are kept below regardless — they're still what proves `windowStartFor`
  // actually buckets on the constant's value, they just don't pin the
  // value on their own.
  it('the session window is exactly one hour — asserted directly against the constant, not re-derived from arithmetic a doubled window would still satisfy', () => {
    expect(ESSAY_SUBMISSION_SESSION_WINDOW_MS).toBe(60 * 60 * 1000);
  });

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

  // Round-2 review (Test Lead) — same gap, same fix, as the session window's
  // own direct assertion above: the IP-scoped window shares `windowStartFor`
  // but is a SEPARATE constant (`ESSAY_SUBMISSION_IP_WINDOW_MS`), so a
  // refactor that widened only this one would pass every edge test above
  // (none of them exercise the IP-scoped window) and pass every IP-scoped
  // test below too, for the exact reason described above: this file's fixed
  // instants divide evenly by small widening factors.
  it('the IP window is exactly one hour — asserted directly against the constant', () => {
    expect(ESSAY_SUBMISSION_IP_WINDOW_MS).toBe(60 * 60 * 1000);
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

  // Round-2 review (Test Lead) — same direct-assertion fix as both essay
  // window tests above, for the same reason: this endpoint has its OWN pair
  // of window constants (`GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS`,
  // `GUEST_SESSION_RESOLVE_IP_WINDOW_MS`), and the edge tests below alone
  // only pin them downward — see the essay session window's own comment
  // above for the measured, worked example (a widened window still passing
  // every edge test in this file).
  it('the session window is exactly one hour — asserted directly against the constant', () => {
    expect(GUEST_SESSION_RESOLVE_SESSION_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('the IP window is exactly one hour — asserted directly against the constant', () => {
    expect(GUEST_SESSION_RESOLVE_IP_WINDOW_MS).toBe(60 * 60 * 1000);
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

  // Round-2 review (Architect, Test Lead, independently): a session-scoped
  // refusal used to log no identity at all, on the reasoning that a session
  // id is a bearer credential and shouldn't be logged "hashed or not" — see
  // `logRefusal`'s own comment for why that rule was backwards. Five hundred
  // session-scoped refusal lines that all looked identical (no way to tell
  // one repeat abuser from five hundred different learners) is exactly the
  // gap this test now proves closed: the correlation key must be present,
  // must differ between two different sessions (proving it's a real
  // per-identity hash, not a shared placeholder), and the raw session id
  // must still never appear, in any form.
  it('logs one structured line naming the session cap, its count, and a WARNING severity when it fires — with a per-session correlation key, never the raw session id', async () => {
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
        severity: 'WARNING',
        action: 'essaySubmission',
        scope: 'session',
        limit: ESSAY_SUBMISSION_SESSION_LIMIT,
        count: ESSAY_SUBMISSION_SESSION_LIMIT + 1,
      });
      const sessionIdentityHash = (logged as { identityHash?: string }).identityHash;
      expect(sessionIdentityHash).toBeTruthy();
      // The bearer credential itself must never appear in the log line, in
      // any form, raw or as a substring of the hash — only a correlation
      // key derived from it.
      expect(line).not.toContain(sessionId);

      // Final review round (Test Lead, blocking, measured against all 31
      // tests green beforehand): "two different sessions produce two
      // different hashes" plus "the raw value is never a substring" is
      // satisfied by ANY injective function, including a REVERSIBLE one —
      // replacing `hashAndTruncate` with `value.split('').reverse().join('')`
      // or with `Buffer.from(value).toString('base64').slice(0, 12)` both
      // passed every assertion this test made before this line, while the
      // reversal logs a 128-bit bearer credential in a form anyone reads
      // backwards — exactly what this module's own comment promises never
      // happens. Pinning the actual SHAPE — twelve lowercase hexadecimal
      // characters, what truncated `sha256(...).digest('hex')` and only that
      // produces — is what a reversed or base64-encoded 32-character hex
      // session id can never satisfy.
      expect(sessionIdentityHash).toMatch(/^[0-9a-f]{12}$/);

      // Stability: the SAME session refused a second time must produce the
      // SAME correlation key — otherwise the "correlation" this value exists
      // to provide (see `logRefusal`'s own comment — distinguishing one
      // repeat abuser from many different learners) doesn't actually hold
      // across log lines, only within one.
      logSpy.mockClear();
      await checkEssaySubmissionRateLimit(sessionId, null, FIXED_NOW);
      const [repeatLine] = logSpy.mock.calls[0] as [string];
      const repeatLogged: unknown = JSON.parse(repeatLine);
      expect((repeatLogged as { identityHash?: string }).identityHash).toBe(sessionIdentityHash);

      // A different session refused the same way must produce a DIFFERENT
      // correlation key — otherwise this "identityHash" is a constant that
      // happens to satisfy the assertions above without actually
      // distinguishing one session's refusals from another's, defeating the
      // entire point of adding it.
      const otherSessionId = generateGuestSessionId();
      for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
        await checkEssaySubmissionRateLimit(otherSessionId, null, FIXED_NOW);
      }
      logSpy.mockClear();
      await checkEssaySubmissionRateLimit(otherSessionId, null, FIXED_NOW);
      const [otherLine] = logSpy.mock.calls[0] as [string];
      const otherLogged: unknown = JSON.parse(otherLine);
      expect((otherLogged as { identityHash?: string }).identityHash).not.toBe(sessionIdentityHash);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs the IP cap by scope, with a WARNING severity and a hashed/truncated address, never the raw one', async () => {
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
      expect(ipLog).toMatchObject({ severity: 'WARNING', action: 'essaySubmission', scope: 'ip', limit: ESSAY_SUBMISSION_IP_LIMIT });
      expect((ipLog as { identityHash?: string }).identityHash).toBeTruthy();
      expect(ipLogLine).not.toContain(ip);
    } finally {
      logSpy.mockRestore();
    }
  });
});

/**
 * Round-2 review (Test Lead): `positiveIntEnv` was correct on every branch
 * but exercised by nothing — the module-load constants that call it once
 * (`ESSAY_SUBMISSION_IP_LIMIT` etc.) can't cheaply re-trigger it per case,
 * so relaxing the `> 0` check in some later edit (letting a configured `0`
 * through) would mean every address is refused, in production, with no test
 * anywhere going red. Exported specifically so this table can call it
 * directly. `undefined` (env var truly absent) and `''` (present but empty)
 * are tested as two separate rows, not folded into one "falsy" case — they
 * are two different states of `process.env` on the way in, both required to
 * fall back the same way.
 */
describe('positiveIntEnv — every branch table-driven, so a relaxed positivity check can never mean "refuse everyone" silently', () => {
  const FALLBACK = 42;

  // `console.warn` is not asserted against in this table — see the dedicated
  // "warns" describe block below for that — but every rejected row DOES now
  // call it (`positiveIntEnv`'s own comment), so it's silenced here purely
  // to keep this table's own output clean.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each<[string, string | undefined, number]>([
    ['unset entirely', undefined, FALLBACK],
    ['the empty string', '', FALLBACK],
    ['non-numeric text', 'not-a-number', FALLBACK],
    ['zero', '0', FALLBACK],
    ['a negative integer', '-5', FALLBACK],
    ['a valid positive integer', '17', 17],
    // Decided (this function's own comment): scientific notation is
    // REJECTED, not silently truncated to its leading digit —
    // `Number.parseInt` alone would have parsed this as `1`, a wildly
    // different (and far stricter) cap than the `10000` an operator
    // presumably meant, with no error either way.
    ['scientific notation', '1e4', FALLBACK],
    // Decided (this function's own comment): a fractional value is
    // REJECTED, not rounded or floored — `Number.parseInt` alone would have
    // silently truncated this to `5`.
    ['a fractional value', '5.5', FALLBACK],
    // A leading '+' is a valid JS numeric literal but not a plain digit
    // string — rejected the same way, falling back rather than being
    // parsed leniently.
    ['a leading plus sign', '+5', FALLBACK],
    // Final review round (Architect, consider): the digits-only regex above
    // has no length bound, so a 23-digit typo used to pass it AND the `> 0`
    // check, returning a number large enough to effectively disable the cap
    // it configures — the unsafe direction the stricter parse left open.
    // `Number.isSafeInteger` closes it: this now falls back the same as any
    // other rejected value, rather than silently unbounding a cap.
    ['an over-long digit string past Number.MAX_SAFE_INTEGER — the unsafe direction, not just the lenient one', '99999999999999999999999', FALLBACK],
    // Whitespace-padded strings AROUND an otherwise-valid integer are
    // accepted (trimmed first) — a value pasted from a shell or a platform
    // console realistically carries stray whitespace, and falling back
    // silently on that is a worse failure mode than trimming it, the same
    // reasoning this function already applies to scientific notation and
    // fractions in the other direction.
    ['a valid integer padded with whitespace', '  17\t\n', 17],
    // Whitespace-ONLY is equivalent to unset/empty, not a "rejected" value —
    // nothing was actually typed to reject. See the "warns" block below for
    // why that distinction matters (no warning fires for this row).
    ['whitespace only', '   ', FALLBACK],
  ])('%s falls back to the default (%s -> %s is asserted per row, never 0 or Infinity)', (_label, envValue, expected) => {
    vi.stubEnv('RATE_LIMIT_TEST_VALUE', envValue);
    try {
      expect(positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK)).toBe(expected);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * KAN-25 final review round (Test Lead, consider): the stricter parse above
 * widened the set of values that fall back, and nothing told an operator
 * their override was ignored — type a value in scientific notation, get the
 * default, no log, no error. See `.env.example`'s own KAN-25 section for the
 * accepted-format documentation half of this fix; this is the runtime half.
 */
describe('positiveIntEnv — warns exactly when a PRESENT value is rejected, never for an absent or blank one', () => {
  const FALLBACK = 42;

  it('does not warn when the variable is unset or blank — nothing was actually typed to reject', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', undefined);
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', '');
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', '   ');
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('does not warn when the override is accepted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', '17');
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('warns once, with the variable name, the rejected raw value, and the fallback in use, when a present value is rejected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', '1e4');
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [line] = warnSpy.mock.calls[0] as [string];
      const logged: unknown = JSON.parse(line);
      expect(logged).toMatchObject({
        severity: 'WARNING',
        name: 'RATE_LIMIT_TEST_VALUE',
        value: '1e4',
        fallback: FALLBACK,
      });
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  // The over-long/unsafe-integer case is a rejection too, not merely the
  // syntactic ones above — an operator typing 23 digits is just as unaware
  // their override was ignored as one typing scientific notation.
  it('warns for an over-long digit string that would exceed Number.MAX_SAFE_INTEGER, the same as any other rejected value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.stubEnv('RATE_LIMIT_TEST_VALUE', '99999999999999999999999');
      positiveIntEnv('RATE_LIMIT_TEST_VALUE', FALLBACK);

      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
