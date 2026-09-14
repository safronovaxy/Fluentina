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

function postWithCookie(cookieValue?: string, headers?: Record<string, string>): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
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

  it('rejects a request with no cookie at all — 400, no session resolved, no row created', async () => {
    const response = await POST(postWithCookie());

    expect(response.status).toBe(400);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects a malformed or forged cookie the same way — 400, and the forged value never becomes a row', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(postWithCookie(forged));

    expect(response.status).toBe(400);
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
  it('rejects a mismatched Origin header with 400, even with an otherwise valid cookie, and creates no row', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(postWithCookie(validCookie, { origin: 'https://evil.example' }));

    expect(response.status).toBe(400);
    expect(await getGuestSessionById({ kind: 'guest', sessionId: validCookie }, validCookie)).toBeNull();
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
