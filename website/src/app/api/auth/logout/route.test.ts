/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { resolveRegisteredSession } from '@/lib/domain/registered-session';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { resetDatabase, createTestSession, closePool } from '@/test/db-fixtures';
import { registerTestAccount } from '@/test/auth-fixtures';
import { attributeValue, bodilessPost, cookieAttributes, setCookieLine, setCookieValue } from '@/test/auth-requests';

const PATH = '/api/auth/logout';
const withSession = (token: string) => ({ cookies: { [REGISTERED_SESSION_COOKIE_NAME]: token } });
const resolve = (token: string) => resolveRegisteredSession((name) => (name === REGISTERED_SESSION_COOKIE_NAME ? token : undefined));

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

describe('POST /api/auth/logout', () => {
  it('DELETES the session row — not just the cookie — so the token is dead server-side', async () => {
    const account = await registerTestAccount();
    expect(await db.select().from(sessions)).toHaveLength(1);

    const response = await POST(bodilessPost(PATH, withSession(account.token)));

    expect(response.status).toBe(200);
    // The credential is gone from the database: this is what separates a real
    // logout from a cookie-only one, which would leave this row live.
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await resolve(account.token)).toBeNull();
  });

  it('a stolen copy of the token stops working the moment the user logs out', async () => {
    const account = await registerTestAccount();
    const stolenCopy = account.token;
    expect(await resolve(stolenCopy)).not.toBeNull();

    await POST(bodilessPost(PATH, withSession(account.token)));

    expect(await resolve(stolenCopy)).toBeNull();
  });

  it('then clears the cookie with IDENTICAL attributes and Max-Age=0 — a __Host- cookie is not cleared by a delete that omits Secure or Path=/', async () => {
    const account = await registerTestAccount();

    const response = await POST(bodilessPost(PATH, withSession(account.token)));

    const line = setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME);
    expect(line).toBeDefined();
    expect(setCookieValue(line!)).toBe('');
    expect(attributeValue(line!, 'Max-Age')).toBe('0');
    expect(cookieAttributes(line!).sort()).toEqual(['httponly', 'max-age', 'path', 'samesite', 'secure']);
    expect(attributeValue(line!, 'Path')).toBe('/');
    expect(attributeValue(line!, 'SameSite')?.toLowerCase()).toBe('lax');
  });

  it('ends only the session presented: the same user\'s session elsewhere, and other users\', stay signed in', async () => {
    const account = await registerTestAccount();
    const other = await registerTestAccount();
    // A real second session for the SAME account, minted the way a second
    // sign-in would: a fresh token, a fresh row, one `user_id`.
    const secondDevice = generateRegisteredSessionToken();
    await createTestSession({ kind: 'user', userId: account.userId }, hashRegisteredSessionToken(secondDevice));

    await POST(bodilessPost(PATH, withSession(account.token)));

    expect(await resolve(other.token)).not.toBeNull();
    expect(await resolve(secondDevice)).not.toBeNull();
    expect(await resolve(account.token)).toBeNull();
    expect((await db.select().from(sessions)).map((row) => row.id).sort()).toEqual(
      [hashRegisteredSessionToken(other.token), hashRegisteredSessionToken(secondDevice)].sort(),
    );
  });

  it.each([
    ['no cookie', undefined],
    ['a malformed cookie', 'not-a-token'],
    ['a well-formed token naming no session', 'a'.repeat(64)],
  ])('is idempotent with %s: 200, and the cookie is cleared anyway', async (_label, value) => {
    const response = await POST(bodilessPost(PATH, value === undefined ? {} : withSession(value)));

    expect(response.status).toBe(200);
    expect(attributeValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!, 'Max-Age')).toBe('0');
  });

  it('when the delete FAILS it says so (500) and does NOT clear the cookie: never report "signed out" while the credential is live', async () => {
    const account = await registerTestAccount();
    vi.spyOn(db, 'delete').mockImplementation(() => {
      throw new Error('down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(bodilessPost(PATH, withSession(account.token)));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { reason: string }).reason).toBe('internalError');
    expect(response.headers.getSetCookie()).toEqual([]);
    vi.restoreAllMocks();
    expect(await resolve(account.token)).not.toBeNull();
  });

  it('rejects a cross-origin request and leaves the session alone', async () => {
    const account = await registerTestAccount();

    const response = await POST(bodilessPost(PATH, { ...withSession(account.token), headers: { origin: 'https://evil.example', host: 'localhost:3000' } }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { reason: string }).reason).toBe('crossOrigin');
    expect(await resolve(account.token)).not.toBeNull();
  });
});
