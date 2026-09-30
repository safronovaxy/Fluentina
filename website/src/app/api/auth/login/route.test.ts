/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db/client';
import { essays, rateLimitCounters, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveRegisteredSession } from '@/lib/domain/registered-session';
import { resolveOwnerActor } from '@/lib/domain/owner-actor';
import { createEssay, getEssayById } from '@/lib/db/essays';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT, checkLoginRateLimit } from '@/lib/domain/rate-limit';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { emailSchema } from '@/lib/contracts/auth';
import { registeredSessionTokenSchema, type GuestActor } from '@/lib/contracts/actor';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, countGuestSessions, closePool } from '@/test/db-fixtures';
import { TEST_PASSWORD, registerTestAccount } from '@/test/auth-fixtures';
import { attributeValue, cookieAttributes, jsonPost, setCookieLine, setCookieValue, xff } from '@/test/auth-requests';

const PATH = '/api/auth/login';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface Rejection {
  error: string;
  reason?: string;
}

async function counterMap(): Promise<Map<string, number>> {
  return new Map((await db.select().from(rateLimitCounters)).map((row) => [row.bucketKey, row.count]));
}

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

describe('POST /api/auth/login — success', () => {
  it('signs the user in: 200, {ok: true}, and a session cookie with all five attributes', async () => {
    const account = await registerTestAccount();

    const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const line = setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME);
    expect(line).toBeDefined();
    expect(cookieAttributes(line!).sort()).toEqual(['expires', 'httponly', 'max-age', 'path', 'samesite', 'secure']);
    expect(attributeValue(line!, 'Path')).toBe('/');
    expect(attributeValue(line!, 'Max-Age')).toBe(String(14 * 24 * 60 * 60));
    expect(attributeValue(line!, 'SameSite')?.toLowerCase()).toBe('lax');
  });

  it('the cookie carries the token, the database holds only its hash, and the cookie authenticates as that user', async () => {
    const account = await registerTestAccount();
    await db.delete(sessions);

    const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }));

    const token = registeredSessionTokenSchema.parse(setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!));
    expect((await db.select().from(sessions)).map((row) => row.id)).toEqual([hashRegisteredSessionToken(token)]);
    expect(await resolveRegisteredSession((name) => (name === REGISTERED_SESSION_COOKIE_NAME ? token : undefined))).toEqual({
      kind: 'user',
      userId: account.userId,
    });
  });

  it('accepts the address however it is cased or padded', async () => {
    const account = await registerTestAccount({ email: 'Mixed.Case@Example.test' });

    const response = await POST(jsonPost(PATH, { email: '  MIXED.CASE@example.TEST', password: account.password }));

    expect(response.status).toBe(200);
  });

  it('ROTATES the session: the presented token\'s row is deleted and a different token is issued', async () => {
    const account = await registerTestAccount();
    const [oldRow] = await db.select().from(sessions);

    const response = await POST(
      jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [REGISTERED_SESSION_COOKIE_NAME]: account.token } }),
    );

    const fresh = setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!);
    expect(fresh).not.toBe(account.token);
    const ids = (await db.select().from(sessions)).map((row) => row.id);
    expect(ids).not.toContain(oldRow.id);
    expect(ids).toEqual([hashRegisteredSessionToken(registeredSessionTokenSchema.parse(fresh))]);
    // The old cookie no longer authenticates anyone.
    expect(await resolveRegisteredSession((name) => (name === REGISTERED_SESSION_COOKIE_NAME ? account.token : undefined))).toBeNull();
  });
});

describe('POST /api/auth/login — sign-in adopts the guest essay the browser holds (KAN-52)', () => {
  async function guestWithEssay() {
    const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
    await createGuestSession(guest);
    const essay = await createEssay(guest, 'Ein Aufsatz, geschrieben als Gast, bevor man sich anmeldet.');
    return { guest, essay };
  }
  const guestCookie = (guest: GuestActor) => ({ [GUEST_SESSION_COOKIE_NAME]: guest.sessionId });

  it('the account signed into can read the guest essay afterwards, and the old guest cookie cannot', async () => {
    const account = await registerTestAccount();
    const { guest, essay } = await guestWithEssay();
    expect(await getEssayById({ kind: 'user', userId: account.userId }, essay.id)).toBeNull();

    const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { cookies: guestCookie(guest) }));

    expect(response.status).toBe(200);
    const token = setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!);
    // The same resolution every read route uses, from the cookies this response set.
    const actor = await resolveOwnerActor((name) => ({ [REGISTERED_SESSION_COOKIE_NAME]: token })[name]);
    expect(actor).toEqual({ kind: 'user', userId: account.userId });
    expect((await getEssayById(actor!, essay.id))?.id).toBe(essay.id);
    expect(await getEssayById(guest, essay.id)).toBeNull();
    const [row] = await db.select().from(essays).where(eq(essays.id, essay.id));
    expect(row.userId).toBe(account.userId);
    expect(row.sessionId).toBeNull();
  });

  describe('the guest cookie is DELETED on success', () => {
    it('sends it back with an empty value, Max-Age=0 and EXACTLY the attributes it was set with — a __Host- cookie is not cleared by a delete that omits Secure or Path=/', async () => {
      const account = await registerTestAccount();
      const { guest } = await guestWithEssay();

      const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { cookies: guestCookie(guest) }));

      const line = setCookieLine(response, GUEST_SESSION_COOKIE_NAME);
      expect(line).toBeDefined();
      expect(setCookieValue(line!)).toBe('');
      expect(attributeValue(line!, 'Max-Age')).toBe('0');
      // No `Domain`, which __Host- forbids; Secure, Path=/ and the rest, which it requires.
      expect(cookieAttributes(line!).sort()).toEqual(['httponly', 'max-age', 'path', 'samesite', 'secure']);
      expect(attributeValue(line!, 'Path')).toBe('/');
      expect(attributeValue(line!, 'SameSite')?.toLowerCase()).toBe('lax');
    });

    it('clears it whether or not a guest cookie was presented, and whether or not it named a session', async () => {
      const account = await registerTestAccount();

      const withNone = await POST(jsonPost(PATH, { email: account.email, password: account.password }));
      const withOrphan = await POST(
        jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }),
      );

      for (const response of [withNone, withOrphan]) {
        expect(attributeValue(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)!, 'Max-Age')).toBe('0');
      }
    });

    it('does NOT clear it, and does not adopt, when the credentials are wrong — a mistyped password must not cost a guest their essay', async () => {
      const account = await registerTestAccount();
      const { guest, essay } = await guestWithEssay();

      const response = await POST(jsonPost(PATH, { email: account.email, password: 'not the password' }, { cookies: guestCookie(guest) }));

      expect(response.status).toBe(401);
      expect(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
      expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
    });

    it('does NOT clear it on a 429 — only a committed sign-in clears it', async () => {
      const account = await registerTestAccount();
      const { guest } = await guestWithEssay();
      for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(emailSchema.parse(account.email), null);

      const limited = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { cookies: guestCookie(guest) }));

      expect(limited.status).toBe(429);
      expect(setCookieLine(limited, GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
    });

    it('does NOT clear it on a 500 from the sign-in transaction, and the guest can still read their essay (nothing was adopted)', async () => {
      const account = await registerTestAccount();
      const { guest, essay } = await guestWithEssay();
      vi.spyOn(db, 'transaction').mockRejectedValue(new Error('down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { cookies: guestCookie(guest) }));

      expect(response.status).toBe(500);
      expect(response.headers.getSetCookie()).toEqual([]);
      vi.restoreAllMocks();
      expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
    });
  });

  it('treats a MALFORMED guest cookie as absent: signs in normally, adopts nothing (the guest keeps their essay), and still clears it', async () => {
    const account = await registerTestAccount();
    const { guest, essay } = await guestWithEssay();

    const response = await POST(
      jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: 'not-a-session-id' } }),
    );

    expect(response.status).toBe(200);
    expect(attributeValue(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)!, 'Max-Age')).toBe('0');
    // The essay exists under a real guest session the cookie did not name: nothing was adopted.
    expect(await getEssayById({ kind: 'user', userId: account.userId }, essay.id)).toBeNull();
    expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
  });

  // "Read here and offered to adoption, never RESOLVED": `resolveGuestSession`
  // mints a `guest_sessions` row for a missing or unusable cookie, so a route
  // that resolved instead of parsing would be a second unauthenticated
  // guest-session issuer, one row per attempt — 401s and 429s included, because
  // the cookie is read before the rate limit. Only a row count sees it: the
  // response looks identical either way. (The same property the essays route
  // pins, and `/api/guest-session` took three review rounds to arrive at.)
  describe('a sign-in never mints a guest session — the cookie is parsed, not resolved', () => {
    it('a SUCCESSFUL sign-in presenting no guest cookie leaves guest_sessions unchanged', async () => {
      const account = await registerTestAccount();
      const before = await countGuestSessions();

      const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }));

      expect(response.status).toBe(200);
      expect(await countGuestSessions()).toBe(before);
    });

    it('a FAILED sign-in presenting a malformed guest cookie leaves guest_sessions unchanged', async () => {
      const account = await registerTestAccount();
      const before = await countGuestSessions();

      const response = await POST(
        jsonPost(PATH, { email: account.email, password: 'not the password' }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: 'not-a-session-id' } }),
      );

      expect(response.status).toBe(401);
      expect(await countGuestSessions()).toBe(before);
    });
  });

  it('a guest cookie naming a session that does not exist signs in normally', async () => {
    const account = await registerTestAccount();

    const response = await POST(
      jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }),
    );

    expect(response.status).toBe(200);
  });

  it('the guest cookie plays no part in the rate-limit key: rotating guest cookies gets no fresh bucket', async () => {
    const account = await registerTestAccount();
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) {
      await POST(jsonPost(PATH, { email: account.email, password: 'not the password' }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }));
    }

    const response = await POST(
      jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }),
    );

    expect(response.status).toBe(429);
  });
});

describe('POST /api/auth/login — invalid credentials are ONE answer', () => {
  async function attempt(email: string, password: string, ip: string) {
    const response = await POST(jsonPost(PATH, { email, password }, { headers: xff(ip) }));
    return { status: response.status, body: (await response.json()) as Rejection, cookies: response.headers.getSetCookie() };
  }

  it('answers "no such user" and "wrong password" with the same status, reason, message, and no cookie', async () => {
    const account = await registerTestAccount();

    const unknown = await attempt('nobody@example.test', TEST_PASSWORD, '198.51.100.1');
    const wrong = await attempt(account.email, 'not the password', '198.51.100.2');

    expect(unknown.status).toBe(401);
    expect(unknown).toEqual(wrong);
    expect(unknown.body).toEqual({ error: 'invalid email or password', reason: 'invalidCredentials' });
    expect(unknown.cookies).toEqual([]);
  });

  it('increments BOTH rate-limit counters identically for unknown email, wrong password and success', async () => {
    const account = await registerTestAccount();

    await attempt('nobody@example.test', TEST_PASSWORD, '198.51.100.1');
    await attempt(account.email, 'not the password', '198.51.100.2');
    await attempt(account.email, account.password, '198.51.100.3');

    const counters = await counterMap();
    // One increment on each of the two buckets, per attempt, whatever the outcome.
    expect(counters.get('login:ip:198.51.100.1')).toBe(1);
    expect(counters.get('login:ip:198.51.100.2')).toBe(1);
    expect(counters.get('login:ip:198.51.100.3')).toBe(1);
    expect(counters.get(`login:email:${sha256('nobody@example.test')}`)).toBe(1);
    // The account was attempted twice (wrong password, then right): two on ITS bucket.
    expect(counters.get(`login:email:${sha256(account.email)}`)).toBe(2);
  });

  it('never reveals through the response whether the account exists', async () => {
    const account = await registerTestAccount();

    const responses = await Promise.all([
      POST(jsonPost(PATH, { email: 'nobody@example.test', password: 'whatever it is' }, { headers: xff('198.51.100.11') })),
      POST(jsonPost(PATH, { email: account.email, password: 'whatever it is' }, { headers: xff('198.51.100.12') })),
    ]);

    const texts = await Promise.all(responses.map((r) => r.text()));
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).not.toContain(account.email);
  });
});

describe('POST /api/auth/login — rate limits: two buckets, neither short-circuiting', () => {
  it('refuses with 429 rateLimited once the EMAIL bucket is spent — even the correct password — and still counts the IP', async () => {
    const account = await registerTestAccount();
    const email = emailSchema.parse(account.email);
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(email, null);

    const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { headers: xff('198.51.100.20') }));

    expect(response.status).toBe(429);
    expect(((await response.json()) as Rejection).reason).toBe('rateLimited');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await counterMap()).get('login:ip:198.51.100.20')).toBe(1);
  });

  it('refuses with 429 rateLimited once the IP bucket is spent — and still counts the email', async () => {
    const account = await registerTestAccount();
    for (let i = 0; i < LOGIN_IP_LIMIT; i++) {
      await checkLoginRateLimit(emailSchema.parse(`filler-${i}@example.test`), '198.51.100.21');
    }

    const response = await POST(jsonPost(PATH, { email: account.email, password: account.password }, { headers: xff('198.51.100.21') }));

    expect(response.status).toBe(429);
    expect(((await response.json()) as Rejection).reason).toBe('rateLimited');
    expect((await counterMap()).get(`login:email:${sha256(account.email)}`)).toBe(1);
  });

  it('a refused attempt never verifies a password or creates a session', async () => {
    const account = await registerTestAccount();
    const email = emailSchema.parse(account.email);
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) await checkLoginRateLimit(email, null);
    await db.delete(sessions);

    await POST(jsonPost(PATH, { email: account.email, password: account.password }, { headers: xff('198.51.100.22') }));

    expect(await db.select().from(sessions)).toEqual([]);
  });

  it('the email bucket is keyed on the full SHA-256 of the normalised address — the raw address is in no bucket key', async () => {
    await POST(jsonPost(PATH, { email: '  Person@Example.TEST ', password: 'x' }, { headers: xff('198.51.100.23') }));

    const keys = [...(await counterMap()).keys()];
    expect(keys).toContain(`login:email:${sha256('person@example.test')}`);
    for (const key of keys) expect(key.toLowerCase()).not.toContain('person');
  });

  it('a request that fails validation counts against neither bucket', async () => {
    const response = await POST(jsonPost(PATH, { email: 'not-an-email', password: 'x' }, { headers: xff('198.51.100.24') }));

    expect(response.status).toBe(400);
    expect(await counterMap()).toEqual(new Map());
  });
});

describe('POST /api/auth/login — guards and failures', () => {
  it('rejects a cross-origin request with 400 crossOrigin, before anything is counted', async () => {
    const response = await POST(jsonPost(PATH, { email: 'a@example.test', password: 'x' }, { headers: { origin: 'https://evil.example' } }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe('crossOrigin');
    expect(await counterMap()).toEqual(new Map());
  });

  it.each([
    ['malformed JSON', '{nope', 'invalidJson'],
    ['a body of the wrong shape', { hello: 'world' }, 'invalidSubmission'],
    ['an empty password', { email: 'a@example.test', password: '' }, 'invalidSubmission'],
    ['an over-long password', { email: 'a@example.test', password: 'x'.repeat(129) }, 'invalidSubmission'],
  ])('rejects %s with 400 and reason %s', async (_label, body, reason) => {
    const response = await POST(jsonPost(PATH, body));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe(reason);
  });

  it('applies the body-size guard: an oversized Content-Length is 413 bodyTooLarge with Connection: close', async () => {
    const response = await POST(
      jsonPost(PATH, { email: 'a@example.test', password: 'x' }, { headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) } }),
    );

    expect(response.status).toBe(413);
    expect(((await response.json()) as Rejection).reason).toBe('bodyTooLarge');
    expect(response.headers.get('connection')).toBe('close');
  });

  it('applies the streaming byte count too: a chunked body over the cap with no Content-Length is 413', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(10_000));
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new NextRequest(new URL(`http://localhost:3000${PATH}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    request.headers.delete('content-length');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(response.headers.get('connection')).toBe('close');
    expect(cancelled).toBe(true);
  });

  it('a database failure is a 500 internalError with no cookie, and its log line carries neither the email nor the password', async () => {
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('down: private.person@example.test');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The rate limiter writes (insert), then the lookup reads (select): only the read is broken here.

    const response = await POST(jsonPost(PATH, { email: 'private.person@example.test', password: 'a very private password' }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as Rejection).reason).toBe('internalError');
    expect(response.headers.getSetCookie()).toEqual([]);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('login_failed');
    expect(logged).not.toContain('private.person');
    expect(logged).not.toContain('very private password');
  });

  it('logs nothing that carries the email or the password on the ordinary paths either', async () => {
    const account = await registerTestAccount({ email: 'private.person@example.test', password: 'a very private password' });
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')].map((spy) =>
      spy.mockImplementation(() => {}),
    );

    await POST(jsonPost(PATH, { email: account.email, password: account.password }));
    await POST(jsonPost(PATH, { email: account.email, password: 'not the password' }));
    await POST(jsonPost(PATH, { email: 'ghost@example.test', password: 'not the password' }));

    const everything = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(everything).not.toContain('private.person');
    expect(everything).not.toContain('very private password');
    expect(everything).not.toContain('ghost@example');
  });
});
