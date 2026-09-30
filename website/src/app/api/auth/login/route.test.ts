/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db/client';
import { rateLimitCounters, sessions } from '@/lib/db/schema';
import { resolveRegisteredSession } from '@/lib/domain/registered-session';
import { hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT, checkLoginRateLimit } from '@/lib/domain/rate-limit';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { emailSchema } from '@/lib/contracts/auth';
import { registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, closePool } from '@/test/db-fixtures';
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

  it('does not touch the guest cookie', async () => {
    const account = await registerTestAccount();

    const response = await POST(
      jsonPost(PATH, { email: account.email, password: account.password }, { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }),
    );

    expect(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
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
