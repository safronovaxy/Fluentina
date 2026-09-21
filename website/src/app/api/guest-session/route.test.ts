/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
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
});
