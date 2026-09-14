/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import type { GuestSessionId } from '@/lib/contracts/actor';

function postWithCookie(cookieValue?: string): NextRequest {
  const headers = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL('http://localhost:3000/api/guest-session'), {
    method: 'POST',
    headers,
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

describe('POST /api/guest-session — first visit (no cookie)', () => {
  it('sets a session cookie and creates the corresponding row', async () => {
    const response = await POST(postWithCookie());

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);

    const sessionId = guestSessionIdSchema.parse(cookie?.value);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted?.id).toBe(sessionId);
  });

  it('sets the cookie with HttpOnly, Secure, SameSite=Lax and Path=/ — never readable by client JavaScript', async () => {
    const response = await POST(postWithCookie());

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('never leaks the session id into the JSON response body', async () => {
    const response = await POST(postWithCookie());
    const body: unknown = await response.json();

    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{32}/);
  });
});

describe('POST /api/guest-session — second visit with a valid, already-persisted cookie', () => {
  it('reuses the existing session: no Set-Cookie, no second row', async () => {
    const first = await POST(postWithCookie());
    const issuedId = guestSessionIdSchema.parse(first.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value);

    const second = await POST(postWithCookie(issuedId));

    expect(second.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: issuedId }, issuedId);
    expect(persisted?.id).toBe(issuedId);
  });
});

describe('POST /api/guest-session — malformed or forged cookie', () => {
  it('does not let the presented value become the session id — issues and persists a fresh one instead', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(postWithCookie(forged));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.value).not.toBe(forged);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);

    const forgedActor = { kind: 'guest' as const, sessionId: forged as GuestSessionId };
    expect(await getGuestSessionById(forgedActor, forged)).toBeNull();
  });

  it('a syntactically valid but never-issued id is still accepted and given a row under that same id — entropy, not a denylist, is what makes that safe (see session-id.test.ts)', async () => {
    // Not the "forged" case above: this is the ordinary first-use path
    // (src/middleware.ts having minted this id moments earlier and not
    // being able to persist it itself) — indistinguishable, at this
    // layer, from an attacker's lucky guess. What actually makes trusting
    // it safe is the 128 bits of entropy the id space draws on, not
    // anything this route checks.
    const neverIssued = generateGuestSessionId();

    const response = await POST(postWithCookie(neverIssued));

    // A cookie may or may not be re-sent for this case (the id didn't
    // change), but it must never become a DIFFERENT id than the one
    // presented.
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    if (cookie) expect(cookie.value).toBe(neverIssued);

    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: neverIssued }, neverIssued);
    expect(persisted?.id).toBe(neverIssued);
  });
});
