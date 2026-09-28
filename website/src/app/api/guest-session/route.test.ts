/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { GUEST_SESSION_RESOLVE_SESSION_LIMIT, GUEST_SESSION_RESOLVE_IP_LIMIT } from '@/lib/domain/rate-limit';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestSessionId } from '@/lib/contracts/actor';

function postWithCookie(
  cookieValue?: string,
  headers?: Record<string, string>,
  url = 'http://localhost:3000/api/guest-session',
): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL(url), {
    method: 'POST',
    headers: { ...cookieHeader, ...headers },
  });
}

/**
 * Same production proxy shape `essays/route.test.ts`'s own `xff` helper
 * builds — a client IP followed by the load balancer's own, the two-hop
 * shape `clientIp` (`lib/client-ip.ts`) is written against. See that
 * module's own comment for why the trusted entry is the second-to-last one.
 */
function xff(ip: string): Record<string, string> {
  return { 'x-forwarded-for': `${ip}, 34.120.0.1` };
}

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/guest-session — missing or malformed cookie', () => {
  // Review: this route used to mint a fresh session for anyone who called
  // it with no cookie or a malformed one — including a cross-site page with
  // credentials, in a loop, with no rate limit and no ownership check.
  // Middleware is now the only issuer; this route requires an
  // already-well-formed cookie and rejects outright otherwise.

  // Round-2 review sweep: this route has TWO distinct 400 branches — the
  // cross-origin guard and this cookie guard (see route.ts) — and neither
  // test below used to assert which one actually fired, only the shared
  // status code. A mutant that swapped this branch's message for the
  // cross-origin one's (or vice versa) left both suites green.
  it('rejects a request with no cookie at all — 400, "missing or invalid guest session cookie", reason "invalidSessionCookie", no session resolved, no row created', async () => {
    const response = await POST(postWithCookie());
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
    // KAN-31: `reason` is what tells this guard's 400 apart from the
    // cross-origin guard's own 400 below — both share the status, and
    // nothing here proved which one actually fired before this assertion
    // existed.
    expect(body.reason).toBe('invalidSessionCookie');
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects a malformed or forged cookie the same way — 400, "missing or invalid guest session cookie", reason "invalidSessionCookie", and the forged value never becomes a row', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(postWithCookie(forged));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
    expect(body.reason).toBe('invalidSessionCookie');
    const forgedActor = { kind: 'guest' as const, sessionId: forged as GuestSessionId };
    expect(await getGuestSessionById(forgedActor, forged)).toBeNull();
  });
});

describe('POST /api/guest-session — well-formed cookie, no row yet (ordinary first use)', () => {
  it('creates the row under the presented id — src/middleware.ts having minted it moments earlier on the same navigation, indistinguishable at this layer from an attacker\'s lucky guess; entropy, not a denylist, is what makes trusting it safe (see session-id.test.ts)', async () => {
    const mintedByEdge = generateGuestSessionId();

    const response = await POST(postWithCookie(mintedByEdge));

    expect(response.status).toBe(200);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: mintedByEdge }, mintedByEdge);
    expect(persisted?.id).toBe(mintedByEdge);
  });

  it('sets no cookie at all — the id did not change, so there is nothing to reissue', async () => {
    const mintedByEdge = generateGuestSessionId();

    const response = await POST(postWithCookie(mintedByEdge));

    // Round-1 review (Test Lead, blocking): this scenario's own title
    // ("ordinary first use") is only actually proven by 200 — with the
    // rate limiter mutated to refuse everything, this same cookie-absence
    // assertion would still pass, for a 429 rather than the success case
    // the title claims.
    expect(response.status).toBe(200);
    // Deterministic, not conditional: this scenario's id never changes, so
    // asserting the cookie is absent is always the right check here, not
    // merely "if present, check its value" (which would pass just as well
    // whether or not a cookie ever got weakened into being (re)sent).
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('never leaks the session id into the JSON response body', async () => {
    const mintedByEdge = generateGuestSessionId();

    const response = await POST(postWithCookie(mintedByEdge));
    const body: unknown = await response.json();

    // Round-1 review (Test Lead, blocking): same reasoning as the test
    // above — a body with no hex-looking id in it also describes a 429
    // rejection's body, not only a successful resolution's.
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{32}/);
  });
});

describe('POST /api/guest-session — well-formed cookie, row already exists (returning guest)', () => {
  it('reuses the existing session: no Set-Cookie, no second row', async () => {
    const issuedId = generateGuestSessionId();
    await POST(postWithCookie(issuedId));

    const second = await POST(postWithCookie(issuedId));

    expect(second.status).toBe(200);
    expect(second.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: issuedId }, issuedId);
    expect(persisted?.id).toBe(issuedId);
  });
});

describe('POST /api/guest-session — the cookie names an already-converted session', () => {
  it('mints a fresh id, reissues the cookie, and creates a new row rather than colliding with the converted one', async () => {
    const oldSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: oldSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: oldSessionId }, userId);

    const response = await POST(postWithCookie(oldSessionId));

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(oldSessionId);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);

    const newSessionId = guestSessionIdSchema.parse(cookie?.value);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: newSessionId }, newSessionId);
    expect(persisted?.id).toBe(newSessionId);
    expect(persisted?.userId).toBeNull();
  });

  it('the reissued cookie carries HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime, the same as the original', async () => {
    const oldSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: oldSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: oldSessionId }, userId);

    const response = await POST(postWithCookie(oldSessionId));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });
});

describe('POST /api/guest-session — cross-origin requests', () => {
  // One integration-level test here (round-1 review): the guard's own edge
  // cases — malformed Origin, absent Host/forwarded-host, forwarded-host
  // precedence, and the `output: standalone`/Cloud Run URL shape (round 2)
  // — are unit-tested directly against `isCrossOriginRequest` in
  // `lib/same-origin.test.ts` now, so this file only needs to prove the
  // guard is actually wired into THIS route, ahead of session resolution.
  // Round-2 review sweep: same reason as the missing-cookie tests above —
  // a bare 400 here doesn't distinguish this guard from the cookie guard,
  // which also 400s and which this fixture's cookie is deliberately
  // well-formed FOR, specifically so a 400 here can only be the cross-origin
  // guard. Asserting the exact message is what makes that true rather than
  // merely intended.
  it('rejects a mismatched Origin header with 400, "cross-origin request rejected", reason "crossOrigin", even with an otherwise valid cookie, and creates no row', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(postWithCookie(validCookie, { origin: 'https://evil.example' }));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('cross-origin request rejected');
    // KAN-31: proves this 400 is the cross-origin guard, not the cookie
    // guard — this fixture's cookie is deliberately well-formed FOR that
    // reason (see this describe block's own comment above).
    expect(body.reason).toBe('crossOrigin');
    expect(await getGuestSessionById({ kind: 'guest', sessionId: validCookie }, validCookie)).toBeNull();
  });

  // Round-2 review: this suite had no test carrying a MATCHING Origin at
  // all — the test above only exercises the reject direction, so a mutant
  // that made this route reject anything bearing an Origin header at all
  // left every unit test in this file green; only a browser test caught
  // it. And separately, this route's own request in production is bound to
  // the `output: standalone` container address (`https://0.0.0.0:8080`,
  // see this route's own comment and lib/same-origin.ts's), not the public
  // hostname the browser's Origin and the load balancer's forwarded Host
  // both carry — reproduced directly here (see lib/same-origin.test.ts's
  // equivalent unit test for the same shape against isCrossOriginRequest
  // itself). If someone reintroduced the inline `request.nextUrl.origin`
  // comparison this route's own comment documents as the actual production
  // outage, this would fail: nextUrl's host in that shape is always
  // 0.0.0.0:8080, which never equals the public hostname below.
  it('accepts a same-origin request even when it is bound to the container address rather than the deployed public hostname — the real output:standalone/Cloud Run shape (round-2 review)', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(
      postWithCookie(
        validCookie,
        { origin: 'https://fluentina.com', 'x-forwarded-host': 'fluentina.com' },
        'https://0.0.0.0:8080/api/guest-session',
      ),
    );

    expect(response.status).toBe(200);
    expect(await getGuestSessionById({ kind: 'guest', sessionId: validCookie }, validCookie)).not.toBeNull();
  });
});

// Post-approval hardening (KAN-10): the whole "browser can't forge
// x-forwarded-host without triggering an unanswered CORS preflight"
// argument in route.ts's comment rests on this route exporting no OPTIONS
// handler. Nothing pinned that absence, so a later story (e.g. KAN-14)
// could add one — or add CORS headers — and silently reopen the forged-
// header path. Assert it directly.
describe('POST /api/guest-session — preflight surface', () => {
  it('exports no OPTIONS handler — the forged-header path stays closed only as long as this is true', async () => {
    const routeModule: Record<string, unknown> = await import('./route');

    expect(routeModule.OPTIONS).toBeUndefined();
  });
});

/**
 * KAN-25 — the accumulated finding this story owns for this route: the
 * `SessionIdUnavailableError` recovery inside `resolveGuestSession` (a
 * presented cookie naming an already-converted session) used to mint a
 * fresh row on every single call from a client that kept presenting the
 * same stale id, with nothing bounding how many times that could happen.
 * These tests reproduce exactly that shape — the SAME raw cookie value,
 * presented repeatedly — and prove the session-scoped counter (keyed on
 * that raw value, not whatever id gets resolved underneath it) now bounds
 * it. Same "assert the successes, not just the refusal" discipline
 * `essays/route.test.ts`'s equivalent block follows.
 *
 * Round-2 review (Test Lead, noted rather than fixed — same note as
 * `essays/route.test.ts`'s own equivalent KAN-25 block): this describe
 * block and the per-IP one below it both call `POST` directly, which calls
 * `checkGuestSessionResolveRateLimit` with no explicit `now`, so these run
 * against real wall-clock time rather than a fixed instant. See that other
 * file's own comment for the measured flake rate and why this is left as a
 * named risk rather than a fix.
 */
describe('POST /api/guest-session — KAN-25: the per-session rate limit bounds the converted-session remint loop', () => {
  it('allows exactly the limit\'s worth of calls presenting the same stale, already-converted cookie — each one genuinely resolves and reissues — then rejects the next', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      const response = await POST(postWithCookie(staleSessionId));
      expect(response.status).toBe(200);
      // Each call really does mint a fresh row and reissue the cookie — the
      // exact behaviour the accumulated finding says is unbounded today;
      // this loop proves it still WORKS, just not forever.
      const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
      expect(cookie?.value).not.toBe(staleSessionId);
    }

    const response = await POST(postWithCookie(staleSessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
    // Confirms the rejection happened before resolveGuestSession ran at all
    // for this call — no cookie reissued, nothing minted for it.
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('does not let one presented cookie\'s exhausted cap affect a different one', async () => {
    const exhaustedRawId = generateGuestSessionId();
    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      const response = await POST(postWithCookie(exhaustedRawId));
      expect(response.status).toBe(200);
    }
    const exhaustedResponse = await POST(postWithCookie(exhaustedRawId));
    expect(exhaustedResponse.status).toBe(429); // establishes it really is exhausted

    const freshRawId = generateGuestSessionId();
    const freshResponse = await POST(postWithCookie(freshRawId));

    expect(freshResponse.status).toBe(200);
  });
});

/**
 * KAN-25 — the per-IP backstop for this route. Looser than `/api/essays`'s
 * own (see `lib/domain/rate-limit.ts`'s own comment for the cost-based
 * justification), but proven the same way: a brand-new, never-before-seen
 * cookie value from an already-exhausted IP is still refused, which only
 * the IP-scoped counter — not the per-cookie one — could be responsible for.
 */
describe('POST /api/guest-session — KAN-25: the per-IP backstop', () => {
  it('blocks a request presenting a BRAND-NEW cookie value once that IP has exhausted its backstop', async () => {
    const sharedIp = '198.51.100.52';

    for (let i = 0; i < GUEST_SESSION_RESOLVE_IP_LIMIT; i++) {
      const response = await POST(postWithCookie(generateGuestSessionId(), xff(sharedIp)));
      expect(response.status).toBe(200);
    }

    const response = await POST(postWithCookie(generateGuestSessionId(), xff(sharedIp)));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
  });

  it('does not let one IP\'s exhausted backstop affect a different IP', async () => {
    const exhaustedIp = '198.51.100.53';
    for (let i = 0; i < GUEST_SESSION_RESOLVE_IP_LIMIT; i++) {
      const response = await POST(postWithCookie(generateGuestSessionId(), xff(exhaustedIp)));
      expect(response.status).toBe(200);
    }
    const exhaustedResponse = await POST(postWithCookie(generateGuestSessionId(), xff(exhaustedIp)));
    expect(exhaustedResponse.status).toBe(429);

    const differentIpResponse = await POST(postWithCookie(generateGuestSessionId(), xff('198.51.100.54')));

    expect(differentIpResponse.status).toBe(200);
  });
});

/**
 * KAN-31 — "do not let a reason leak anything", extended to this route's own
 * two guards, the same guarantee `/api/essays`' equivalent block
 * (route.test.ts) pins for all five of its own. `reason` is a fixed string
 * off `REJECTION_REASONS`, never built from anything request-specific, so
 * there is no path today that could leak through it — these tests exist so
 * a later change that started echoing request detail into a rejection body
 * fails immediately.
 */
describe('POST /api/guest-session — KAN-31: guard rejections never leak the session id', () => {
  it('a cross-origin rejection does not echo the (rejected) cookie value into the response body', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(postWithCookie(validCookie, { origin: 'https://evil.example' }));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    // Round-1 review: neither assertion below is reachable by a guard that
    // never runs — before this fix, a success body (which asserts nothing
    // here) or a later guard returning the same shape both passed silently.
    // Status plus the specific reason is what proves THIS guard fired.
    expect(response.status).toBe(400);
    expect(body.reason).toBe('crossOrigin');
    expect(rawBody).not.toContain(validCookie);
  });

  it('an invalid-session-cookie rejection does not echo the forged cookie value into the response body', async () => {
    const forged = 'attacker-supplied-value-that-must-not-echo';

    const response = await POST(postWithCookie(forged));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    // See the cross-origin test's own comment above.
    expect(response.status).toBe(400);
    expect(body.reason).toBe('invalidSessionCookie');
    expect(rawBody).not.toContain(forged);
  });

  // KAN-25: the same guarantee, extended to the new rate-limit rejection.
  it('a rate-limited rejection does not echo the (exhausted) cookie value into the response body', async () => {
    const staleSessionId = generateGuestSessionId();
    for (let i = 0; i < GUEST_SESSION_RESOLVE_SESSION_LIMIT; i++) {
      const setupResponse = await POST(postWithCookie(staleSessionId));
      expect(setupResponse.status).toBe(200); // establishes the cap is genuinely exhausted below
    }

    const response = await POST(postWithCookie(staleSessionId));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
    expect(rawBody).not.toContain(staleSessionId);
  });
});
