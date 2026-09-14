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
  it('rejects a mismatched Origin header with 400, even with an otherwise valid cookie', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(postWithCookie(validCookie, { origin: 'https://evil.example' }));

    expect(response.status).toBe(400);
    expect(await getGuestSessionById({ kind: 'guest', sessionId: validCookie }, validCookie)).toBeNull();
  });

  it('accepts a same-origin Origin header, matched against the Host header rather than the request URL', async () => {
    const validCookie = generateGuestSessionId();

    const response = await POST(postWithCookie(validCookie, { origin: 'http://localhost:3000', host: 'localhost:3000' }));

    expect(response.status).toBe(200);
  });

  // Review (round 2): both of the tests below reproduce the actual
  // production bug this round exists to fix, and the Test Lead confirmed
  // the first one fails against pre-fix HEAD (a real 400, not this file's
  // http://localhost:3000-built fixture). Next's `output: standalone`
  // server builds `request.nextUrl` from the container bind address
  // (`HOSTNAME`/`PORT`), not from any header — so on Cloud Run
  // `request.nextUrl.origin` is always `https://0.0.0.0:8080`, a value no
  // real browser can ever send as `Origin`. Comparing against
  // `request.nextUrl.origin` therefore rejected every real guest's first
  // POST, in production, unconditionally — see route.ts's own comment.
  // These build the request the same broken way (a URL bound to
  // `0.0.0.0:8080`, nothing like the browser's `Origin`) and prove the
  // fixed comparison — Origin's host against `x-forwarded-host` — gets it
  // right in both directions.
  it('accepts a same-origin request even when the request URL itself is bound to a different host than the browser Origin — the real production shape (round 2 review)', async () => {
    const validCookie = generateGuestSessionId();
    const req = new NextRequest(new URL('https://0.0.0.0:8080/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${validCookie}`,
        origin: 'https://fluentina.com',
        'x-forwarded-host': 'fluentina.com',
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
  });

  it('still rejects a genuinely foreign Origin, even with the same x-forwarded-host a legitimate request would carry — proves the fix compares hosts, not merely stops checking', async () => {
    const validCookie = generateGuestSessionId();
    const req = new NextRequest(new URL('https://0.0.0.0:8080/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${validCookie}`,
        origin: 'https://evil.example',
        'x-forwarded-host': 'fluentina.com',
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    expect(await getGuestSessionById({ kind: 'guest', sessionId: validCookie }, validCookie)).toBeNull();
  });

  // Post-approval hardening (KAN-10): a malformed Origin is documented as
  // "always a mismatch, never absent" (see originHost's own doc comment),
  // but nothing exercised that with an actual malformed header until now.
  it('rejects a malformed Origin header with 400, even alongside an otherwise valid Host', async () => {
    const validCookie = generateGuestSessionId();
    const req = new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${validCookie}`,
        origin: 'not a url',
        host: 'localhost:3000',
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  // Post-approval hardening (KAN-10): originHost() and forwardedHost() both
  // return `null` on absence/malformation, and `null !== null` is `false`
  // — so a malformed Origin with NO host header at all used to collapse
  // the mismatch check into a match and get accepted. Before this fix this
  // request returned 200; the assertion below is what pins it at 400.
  it('rejects a malformed Origin header with no Host or x-forwarded-host header at all — absence on both sides must not collapse into a match', async () => {
    const validCookie = generateGuestSessionId();
    const req = new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${validCookie}`,
        origin: 'not a url',
      },
    });
    // NextRequest always carries some Host under the hood via the URL it's
    // constructed from in Node; strip it explicitly so neither header this
    // route reads is present, reproducing the real "no proxy header at
    // all" case forwardedHost()'s doc comment describes.
    req.headers.delete('host');

    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  // Post-approval hardening (KAN-10): the precedence of
  // `x-forwarded-host ?? host` in forwardedHost() is unpinned by every
  // other test here, because none of them present both headers with
  // different values — so silently reversing to `host ?? x-forwarded-host`
  // would leave the rest of this suite green. This test presents both with
  // different values and asserts the one actually compared is
  // x-forwarded-host: an Origin matching x-forwarded-host is accepted even
  // though it disagrees with Host, and the reverse (below) is rejected.
  it('compares Origin against x-forwarded-host, not Host, when the two disagree', async () => {
    const validCookie = generateGuestSessionId();
    const acceptedReq = new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${validCookie}`,
        origin: 'https://fluentina.com',
        'x-forwarded-host': 'fluentina.com',
        host: 'evil.example',
      },
    });

    const accepted = await POST(acceptedReq);

    expect(accepted.status).toBe(200);

    const rejectedCookie = generateGuestSessionId();
    const rejectedReq = new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
      method: 'POST',
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${rejectedCookie}`,
        origin: 'https://evil.example',
        'x-forwarded-host': 'fluentina.com',
        host: 'evil.example',
      },
    });

    const rejected = await POST(rejectedReq);

    expect(rejected.status).toBe(400);
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
