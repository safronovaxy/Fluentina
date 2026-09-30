/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db/client';
import { consentRecords, essays, guestSessions, rateLimitCounters, sessions, users } from '@/lib/db/schema';
import { createEssay, getEssayById } from '@/lib/db/essays';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { resolveOwnerActor } from '@/lib/domain/owner-actor';
import { resolveRegisteredSession } from '@/lib/domain/registered-session';
import { hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { REGISTRATION_IP_LIMIT, REGISTRATION_SESSION_LIMIT, checkRegistrationRateLimit } from '@/lib/domain/rate-limit';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { registeredSessionTokenSchema, type GuestActor } from '@/lib/contracts/actor';
import { CONSENT_KINDS, CURRENT_CONSENT_VERSIONS } from '@/lib/contracts/consent';
import { resetDatabase, countGuestSessions, closePool } from '@/test/db-fixtures';
import { TEST_PASSWORD, registerTestAccount, registrationBody, uniqueEmail } from '@/test/auth-fixtures';
import { attributeValue, cookieAttributes, jsonPost, setCookieLine, setCookieValue, xff } from '@/test/auth-requests';

const PATH = '/api/auth/register';

interface Rejection {
  error: string;
  reason?: string;
}

async function guestWithEssay(): Promise<{ guest: GuestActor; essayId: string }> {
  const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
  await createGuestSession(guest);
  const essay = await createEssay(guest, 'Ein Aufsatz, den der Gast vor der Registrierung geschrieben hat.');
  return { guest, essayId: essay.id };
}

const guestCookie = (guest: GuestActor) => ({ [GUEST_SESSION_COOKIE_NAME]: guest.sessionId });

/** A cookie reader over the session cookie THIS response set, as the browser would send it back. */
const cookieReader = (response: Response) => (name: string) => {
  const line = setCookieLine(response, name);
  return line === undefined ? undefined : setCookieValue(line);
};

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

describe('POST /api/auth/register — success', () => {
  it('creates the account and signs the new user in: 201, {ok: true}, nothing about the account in the body', async () => {
    const response = await POST(jsonPost(PATH, registrationBody({ email: 'ada@example.test' })));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect((await db.select().from(users)).map((u) => u.email)).toEqual(['ada@example.test']);
  });

  it('sets the session cookie with all five attributes: __Host- name, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 14 days — and no Domain', async () => {
    const response = await POST(jsonPost(PATH, registrationBody()));

    const line = setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME);
    expect(line).toBeDefined();
    expect(registeredSessionTokenSchema.safeParse(setCookieValue(line!)).success).toBe(true);
    // `Expires` accompanies `Max-Age` (Next writes both); no `Domain`, which __Host- forbids.
    expect(cookieAttributes(line!).sort()).toEqual(['expires', 'httponly', 'max-age', 'path', 'samesite', 'secure']);
    expect(attributeValue(line!, 'Path')).toBe('/');
    expect(attributeValue(line!, 'Max-Age')).toBe(String(14 * 24 * 60 * 60));
    expect(attributeValue(line!, 'SameSite')?.toLowerCase()).toBe('lax');
  });

  it('the cookie carries the token, and the database holds only its hash', async () => {
    const response = await POST(jsonPost(PATH, registrationBody()));

    const token = registeredSessionTokenSchema.parse(setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!));
    const rows = await db.select().from(sessions);
    expect(rows.map((row) => row.id)).toEqual([hashRegisteredSessionToken(token)]);
    expect(rows.map((row) => row.id)).not.toContain(token);
  });

  it('the cookie actually authenticates: the real resolver turns it into the new user', async () => {
    const response = await POST(jsonPost(PATH, registrationBody()));
    const token = setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!);
    const [user] = await db.select().from(users);

    const actor = await resolveRegisteredSession((name) => (name === REGISTERED_SESSION_COOKIE_NAME ? token : undefined));

    expect(actor).toEqual({ kind: 'user', userId: user.id });
  });

  it('logs nothing that carries the email or the password', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')].map((spy) =>
      spy.mockImplementation(() => {}),
    );

    await POST(jsonPost(PATH, registrationBody({ email: 'private.person@example.test', password: 'a very private password' })));

    const everything = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(everything).not.toContain('private.person');
    expect(everything).not.toContain('very private password');
  });
});

describe('POST /api/auth/register — the guest becomes the user (KAN-20)', () => {
  it('converts the guest\'s essay: the new session owns it, the old guest cookie owns nothing', async () => {
    const { guest, essayId } = await guestWithEssay();

    const response = await POST(jsonPost(PATH, registrationBody(), { cookies: guestCookie(guest) }));
    expect(response.status).toBe(201);

    const token = setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!);
    const actor = await resolveOwnerActor((name) => ({ [REGISTERED_SESSION_COOKIE_NAME]: token })[name]);
    expect(actor?.kind).toBe('user');
    expect((await getEssayById(actor!, essayId))?.id).toBe(essayId);
    expect(await getEssayById(guest, essayId)).toBeNull();
    expect((await db.select().from(guestSessions).where(eq(guestSessions.id, guest.sessionId)))[0].convertedAt).not.toBeNull();
  });

  describe('the guest cookie is DELETED at registration', () => {
    it('sends the guest cookie back with an empty value, Max-Age=0 and EXACTLY the attributes it was set with — a __Host- cookie is not cleared by a delete that omits Secure or Path=/', async () => {
      const { guest } = await guestWithEssay();

      const response = await POST(jsonPost(PATH, registrationBody(), { cookies: guestCookie(guest) }));

      const line = setCookieLine(response, GUEST_SESSION_COOKIE_NAME);
      expect(line).toBeDefined();
      expect(setCookieValue(line!)).toBe('');
      expect(attributeValue(line!, 'Max-Age')).toBe('0');
      // `Expires` accompanies `Max-Age` (Next writes both); no `Domain`, which __Host- forbids.
    expect(cookieAttributes(line!).sort()).toEqual(['httponly', 'max-age', 'path', 'samesite', 'secure']);
      expect(attributeValue(line!, 'Path')).toBe('/');
      expect(attributeValue(line!, 'SameSite')?.toLowerCase()).toBe('lax');
    });

    it('clears it whether or not a guest cookie was presented, and whether or not it named a session', async () => {
      const withNone = await POST(jsonPost(PATH, registrationBody()));
      const withOrphan = await POST(jsonPost(PATH, registrationBody(), { cookies: { [GUEST_SESSION_COOKIE_NAME]: generateGuestSessionId() } }));

      for (const response of [withNone, withOrphan]) {
        expect(attributeValue(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)!, 'Max-Age')).toBe('0');
      }
    });

    it('leaves the stale-cookie remint loop unstarted: no cookie left to name the converted row', async () => {
      const { guest } = await guestWithEssay();
      const response = await POST(jsonPost(PATH, registrationBody(), { cookies: guestCookie(guest) }));

      // What the browser now holds for the guest cookie is nothing, so the next
      // guest-flow page load carries no value naming the converted row — the
      // input that would drive `resolveGuestSession` down its
      // SessionIdUnavailableError branch and mint a guest_sessions row per load.
      expect(setCookieValue(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)!)).not.toContain(guest.sessionId);
    });
  });

  it('a registration with no guest cookie still succeeds', async () => {
    expect((await POST(jsonPost(PATH, registrationBody()))).status).toBe(201);
  });

  // The guest cookie is parsed and offered to conversion, never RESOLVED:
  // `resolveGuestSession` mints a row for a missing or unusable cookie, which
  // would make this route an unauthenticated guest-session issuer. Only a row
  // count sees it (the login route pins the same property).
  describe('registration never mints a guest session — the cookie is parsed, not resolved', () => {
    it('a SUCCESSFUL registration presenting no guest cookie leaves guest_sessions unchanged', async () => {
      const before = await countGuestSessions();

      const response = await POST(jsonPost(PATH, registrationBody()));

      expect(response.status).toBe(201);
      expect(await countGuestSessions()).toBe(before);
    });

    it('a REJECTED registration presenting a malformed guest cookie leaves guest_sessions unchanged', async () => {
      const before = await countGuestSessions();

      const response = await POST(
        jsonPost(PATH, registrationBody({ email: 'not-an-email' }), { cookies: { [GUEST_SESSION_COOKIE_NAME]: 'not-a-session-id' } }),
      );

      expect(response.status).toBe(400);
      expect(await countGuestSessions()).toBe(before);
    });
  });

  it('a guest cookie naming a session that already converted still registers (two tabs) and takes nothing from the first user', async () => {
    const { guest, essayId } = await guestWithEssay();
    const firstBody = registrationBody();
    const secondBody = registrationBody();
    const first = await POST(jsonPost(PATH, firstBody, { cookies: guestCookie(guest) }));
    const second = await POST(jsonPost(PATH, secondBody, { cookies: guestCookie(guest) }));
    const allUsers = await db.select().from(users);

    expect([first.status, second.status]).toEqual([201, 201]);
    // `registrationBody()` mints a fresh email per call, so BOTH registrations
    // created a user: "the essay has some owner" would hold even if the second
    // had stolen it. Pin it to the FIRST registration's user, by the first
    // request's own email, and to the first response's session.
    const [essay] = await db.select().from(essays).where(eq(essays.id, essayId));
    const [firstUser, secondUser] = [firstBody.email, secondBody.email].map(
      (email) => allUsers.find((u) => u.email === email.toLowerCase()),
    );
    expect(firstUser).toBeDefined();
    expect(secondUser).toBeDefined();
    expect(firstUser!.id).not.toBe(secondUser!.id);
    expect(essay.userId).toBe(firstUser!.id);

    const firstActor = await resolveRegisteredSession(cookieReader(first));
    const secondActor = await resolveRegisteredSession(cookieReader(second));
    expect(firstActor).toEqual({ kind: 'user', userId: firstUser!.id });
    expect(await getEssayById(firstActor!, essayId)).not.toBeNull();
    expect(await getEssayById(secondActor!, essayId)).toBeNull();
  });
});

describe('POST /api/auth/register — Set-Cookie only after commit', () => {
  it('a database failure is a 500 with a reason, sets NO cookie of either kind, and converts nothing', async () => {
    const { guest, essayId } = await guestWithEssay();
    vi.spyOn(db, 'transaction').mockRejectedValue(new Error('connection lost'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(jsonPost(PATH, registrationBody(), { cookies: guestCookie(guest) }));
    const body: Rejection = await response.json();

    expect(response.status).toBe(500);
    expect(body.reason).toBe('internalError');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await getEssayById(guest, essayId)).not.toBeNull();
  });

  // Test Lead, KAN-20 review: `registerUser`'s expired-session sweep is the one
  // statement that runs AFTER the transaction has committed. If a failure in it
  // ever propagated, the route would answer 500 with no Set-Cookie after the
  // user, four consent rows, the conversion and the session row were all
  // durable — the person holds an account they have no session for, and the
  // guest cookie names a converted row: the exact outcome the single
  // transaction exists to prevent, reached by the one line outside it.
  it('a failing expired-session sweep AFTER commit does not fail the registration: 201, the session cookie set, one fixed log event', async () => {
    const { guest, essayId } = await guestWithEssay();
    const body = registrationBody({ email: 'private.person@example.test', password: 'a very private password' });
    // Every `db.delete` in the flow is a sweep (the transaction's own statements
    // go through `tx`, and this request replaces no session).
    const deleteSpy = vi.spyOn(db, 'delete').mockImplementation(() => {
      throw new Error('detail mentioning private.person@example.test');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(jsonPost(PATH, body, { cookies: guestCookie(guest) }));

    expect(deleteSpy).toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    const sessionLine = setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME);
    expect(sessionLine).toBeDefined();
    expect(attributeValue(setCookieLine(response, GUEST_SESSION_COOKIE_NAME)!, 'Max-Age')).toBe('0');
    // The committed work is intact and the cookie is one that works.
    deleteSpy.mockRestore();
    const actor = await resolveRegisteredSession(cookieReader(response));
    expect(actor).not.toBeNull();
    expect(await getEssayById(actor!, essayId)).not.toBeNull();
    // The failure is logged as a fixed event and nothing more: no email, no
    // password, none of the error's text, and it is not an error-level log.
    expect(warnSpy.mock.calls).toEqual([[JSON.stringify({ severity: 'WARNING', event: 'session_sweep_failed' })]]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('the failure log line is a fixed event name — no email, no password, no error text', async () => {
    vi.spyOn(db, 'transaction').mockRejectedValue(new Error('detail mentioning private.person@example.test'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(jsonPost(PATH, registrationBody({ email: 'private.person@example.test', password: 'a very private password' })));

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('registration_failed');
    expect(logged).not.toContain('private.person');
    expect(logged).not.toContain('very private password');
    expect(logged).not.toContain('connection');
  });
});

describe('POST /api/auth/register — consent (KAN-21, KAN-22)', () => {
  async function consentRows() {
    return db.select().from(consentRecords);
  }

  it('writes four consent rows — terms, privacy, the 16+ declaration and marketing — each with the version the client presented', async () => {
    await POST(jsonPost(PATH, registrationBody()));

    const rows = await consentRows();
    expect(rows.map((r) => r.kind).sort()).toEqual([...CONSENT_KINDS].sort());
    for (const row of rows) {
      expect(row.documentVersion).toBe(CURRENT_CONSENT_VERSIONS[row.kind as keyof typeof CURRENT_CONSENT_VERSIONS]);
    }
  });

  it('writes the marketing row when the box is UNTICKED, with granted=false: evidence the choice was presented and declined', async () => {
    await POST(jsonPost(PATH, registrationBody({ marketing: false })));

    const marketing = (await consentRows()).filter((r) => r.kind === 'marketingEmail');
    expect(marketing).toHaveLength(1);
    expect(marketing[0].granted).toBe(false);
  });

  it('records marketing granted=true when ticked — independently of the three required rows, which stay granted=true either way', async () => {
    await POST(jsonPost(PATH, registrationBody({ marketing: true })));

    const rows = await consentRows();
    expect(rows.find((r) => r.kind === 'marketingEmail')?.granted).toBe(true);
    expect(rows.filter((r) => r.kind !== 'marketingEmail').every((r) => r.granted)).toBe(true);
  });

  it.each(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus'] as const)(
    'blocks account creation when %s is not accepted: 400, and no user, no consent rows, no session',
    async (kind) => {
      const body = registrationBody();
      body.consent[kind].granted = false as never;

      const response = await POST(jsonPost(PATH, body));

      expect(response.status).toBe(400);
      expect(((await response.json()) as Rejection).reason).toBe('invalidSubmission');
      expect(await db.select().from(users)).toEqual([]);
      expect(await consentRows()).toEqual([]);
      expect(await db.select().from(sessions)).toEqual([]);
    },
  );

  it('blocks account creation when the 16+ declaration is missing altogether — there is no under-16 path', async () => {
    const body = registrationBody();
    const consent: Record<string, unknown> = { ...body.consent };
    delete consent.ageDeclaration16Plus;

    expect((await POST(jsonPost(PATH, { ...body, consent }))).status).toBe(400);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('refuses a stale version with its own reason, staleConsentVersion, and records nothing as agreement', async () => {
    const body = registrationBody();
    body.consent.privacyPolicy.version = '1999-01-01' as never;

    const response = await POST(jsonPost(PATH, body));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe('staleConsentVersion');
    expect(await consentRows()).toEqual([]);
    expect(await db.select().from(users)).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('a stale version alongside a too-short password is invalidSubmission, not staleConsentVersion', async () => {
    const body = registrationBody({ password: 'too short' });
    body.consent.privacyPolicy.version = '1999-01-01' as never;

    expect(((await (await POST(jsonPost(PATH, body))).json()) as Rejection).reason).toBe('invalidSubmission');
  });

  it('refuses a request that never presented the marketing choice at all', async () => {
    const body = registrationBody();
    const consent: Record<string, unknown> = { ...body.consent };
    delete consent.marketingEmail;

    expect((await POST(jsonPost(PATH, { ...body, consent }))).status).toBe(400);
    expect(await db.select().from(users)).toEqual([]);
  });
});

describe('POST /api/auth/register — validation', () => {
  it.each([
    ['a password below the policy minimum', { password: 'too short' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['an over-long password', { password: 'x'.repeat(129) }],
  ])('rejects %s with 400 invalidSubmission and creates nothing', async (_label, override) => {
    const response = await POST(jsonPost(PATH, { ...registrationBody(), ...override }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe('invalidSubmission');
    expect(await db.select().from(users)).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('accepts a 10-character password made of one letter repeated: the policy has no composition rules and no blocklist (out of scope, stated)', async () => {
    expect((await POST(jsonPost(PATH, registrationBody({ password: 'aaaaaaaaaa' })))).status).toBe(201);
  });

  it('ignores a userId or session id smuggled into the body: identity comes from the cookies only', async () => {
    const victim = await registerTestAccount();
    const response = await POST(jsonPost(PATH, { ...registrationBody(), userId: victim.userId, sessionId: generateGuestSessionId() }));

    expect(response.status).toBe(201);
    const [victimRow] = await db.select().from(users).where(eq(users.id, victim.userId));
    expect(victimRow.email).toBe(victim.email);
  });
});

describe('POST /api/auth/register — a duplicate email (a KNOWN email-enumeration oracle)', () => {
  // Recorded as a consequence, not hidden: registration auto-signs-in (Irina,
  // 2026-09-29), so it cannot answer "registered" for an address that already
  // has an account. This test exists so the trade is visible, and so nobody
  // swaps in a fake success without deleting it on purpose.
  it('answers 409 emailAlreadyRegistered — distinguishable from success, which is exactly what makes it an oracle', async () => {
    await registerTestAccount({ email: 'taken@example.test' });

    const response = await POST(jsonPost(PATH, registrationBody({ email: 'taken@example.test' })));
    const body: Rejection = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe('emailAlreadyRegistered');
  });

  it('matches whatever the case or padding, because the stored address is normalised', async () => {
    await registerTestAccount({ email: 'taken@example.test' });

    expect((await POST(jsonPost(PATH, registrationBody({ email: '  TAKEN@Example.TEST ' })))).status).toBe(409);
  });

  it('sets no cookie, clears no guest cookie, converts nothing, and leaves the original account untouched', async () => {
    const original = await registerTestAccount({ email: 'taken@example.test' });
    const { guest, essayId } = await guestWithEssay();

    const response = await POST(jsonPost(PATH, registrationBody({ email: 'taken@example.test' }), { cookies: guestCookie(guest) }));

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await getEssayById(guest, essayId)).not.toBeNull();
    expect(await db.select().from(users)).toHaveLength(1);
    expect((await db.select().from(users))[0].id).toBe(original.userId);
  });
});

describe('POST /api/auth/register — a session the request already carries (fixation)', () => {
  it('deletes that session\'s row and issues a fresh token rather than promoting the old one', async () => {
    const previous = await registerTestAccount();
    const [previousRow] = await db.select().from(sessions);

    const response = await POST(jsonPost(PATH, registrationBody(), { cookies: { [REGISTERED_SESSION_COOKIE_NAME]: previous.token } }));

    const fresh = setCookieValue(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)!);
    expect(fresh).not.toBe(previous.token);
    const ids = (await db.select().from(sessions)).map((row) => row.id);
    expect(ids).not.toContain(previousRow.id);
    expect(ids).toContain(hashRegisteredSessionToken(registeredSessionTokenSchema.parse(fresh)));
  });
});

describe('POST /api/auth/register — guards', () => {
  it('rejects a cross-origin request with 400 crossOrigin, before anything is counted or created', async () => {
    const response = await POST(jsonPost(PATH, registrationBody(), { headers: { origin: 'https://evil.example' } }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe('crossOrigin');
    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(rateLimitCounters)).toEqual([]);
  });

  it('rejects a malformed JSON body with 400 invalidJson', async () => {
    const response = await POST(jsonPost(PATH, '{not json'));

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).reason).toBe('invalidJson');
  });

  describe('the body-size guard POST /api/essays uses', () => {
    it('rejects an honestly oversized Content-Length with 413 bodyTooLarge and Connection: close', async () => {
      const response = await POST(jsonPost(PATH, registrationBody(), { headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) } }));

      expect(response.status).toBe(413);
      expect(((await response.json()) as Rejection).reason).toBe('bodyTooLarge');
      expect(response.headers.get('connection')).toBe('close');
      expect(await db.select().from(users)).toEqual([]);
    });

    it('rejects a body that exceeds the cap when streamed with NO Content-Length, stops reading, and closes the connection', async () => {
      const chunk = new TextEncoder().encode('a'.repeat(10_000));
      let pulls = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
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
      // Limit / chunk = 12.8, so the 13th pull crosses it: bounded at the limit plus one chunk.
      expect(pulls).toBe(Math.floor(MAX_REQUEST_BODY_BYTES / 10_000) + 1);
    });
  });
});

describe('POST /api/auth/register — rate limits (10/IP/hour, plus 5 per presented guest-cookie value)', () => {
  it('refuses the attempt after the per-cookie cap on one guest cookie with 429 rateLimited, from any address', async () => {
    const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
    // The cap's worth of real attempts, each from a different address; invalid bodies keep
    // the fixture cheap (no scrypt) — they are counted before the body is read.
    for (let i = 0; i < REGISTRATION_SESSION_LIMIT; i++) {
      const response = await POST(jsonPost(PATH, {}, { cookies: guestCookie(guest), headers: xff(`192.0.2.${i}`) }));
      expect(response.status).toBe(400);
    }

    const response = await POST(jsonPost(PATH, registrationBody(), { cookies: guestCookie(guest), headers: xff('192.0.2.200') }));

    expect(response.status).toBe(429);
    expect(((await response.json()) as Rejection).reason).toBe('rateLimited');
    expect(await db.select().from(users)).toEqual([]);
  });

  // Four attempts, fixed, not derived from the constant: the point is that THIS
  // sequence survives, so it must fail if the cap drops back to 3. (Skipped only
  // when the cap is overridden by environment, like the default-value test
  // in rate-limit-auth.test.ts.)
  it.skipIf(process.env.RATE_LIMIT_REGISTRATION_SESSION_LIMIT !== undefined)(
    'leaves room to recover: a 409, then two typos, then a correct submission all get through on one guest cookie',
    async () => {
      // The per-cookie limiter runs before the body is read and the guest cookie
      // is cleared only on success, so every failed attempt spends a slot. At a
      // cap of 3 the fourth attempt here was a 429 for the rest of the hour.
      await registerTestAccount({ email: 'taken@example.test' });
      const { guest, essayId } = await guestWithEssay();
      const attempt = (body: unknown) => POST(jsonPost(PATH, body, { cookies: guestCookie(guest) }));

      const taken = await attempt(registrationBody({ email: 'taken@example.test' }));
      const typo1 = await attempt(registrationBody({ password: 'too short' }));
      const typo2 = await attempt(registrationBody({ password: 'too short' }));
      const final = await attempt(registrationBody());

      expect([taken.status, typo1.status, typo2.status, final.status]).toEqual([409, 400, 400, 201]);
      const actor = await resolveRegisteredSession(cookieReader(final));
      expect(await getEssayById(actor!, essayId)).not.toBeNull();
    },
  );

  it('refuses the request after the IP cap with 429 rateLimited', async () => {
    for (let i = 0; i < REGISTRATION_IP_LIMIT; i++) await checkRegistrationRateLimit(null, '198.51.100.4');

    const response = await POST(jsonPost(PATH, registrationBody(), { headers: xff('198.51.100.4') }));

    expect(response.status).toBe(429);
    expect(((await response.json()) as Rejection).reason).toBe('rateLimited');
    expect(await db.select().from(users)).toEqual([]);
  });

  it('checks the limit BEFORE the body is read: an exhausted caller with an oversized body gets 429, not 413', async () => {
    for (let i = 0; i < REGISTRATION_IP_LIMIT; i++) await checkRegistrationRateLimit(null, '198.51.100.4');

    const response = await POST(
      jsonPost(PATH, registrationBody(), { headers: { ...xff('198.51.100.4'), 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) } }),
    );

    expect(response.status).toBe(429);
  });

  it('counts a request refused for a bad body just the same — validation failures are not free', async () => {
    await POST(jsonPost(PATH, { nonsense: true }, { headers: xff('198.51.100.5') }));

    const rows = await db.select().from(rateLimitCounters);
    expect(rows.map((row) => row.bucketKey)).toContain('registration:ip:198.51.100.5');
  });

  it('a malformed guest cookie is treated as absent and buys no fresh per-cookie bucket', async () => {
    await POST(jsonPost(PATH, {}, { cookies: { [GUEST_SESSION_COOKIE_NAME]: 'not-a-session-id' }, headers: xff('198.51.100.6') }));

    const keys = (await db.select().from(rateLimitCounters)).map((row) => row.bucketKey);
    expect(keys).toEqual(['registration:ip:198.51.100.6']);
  });

  it('a rate-limiter database failure is a 500, not a bypass', async () => {
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(jsonPost(PATH, registrationBody(), { headers: xff('198.51.100.7') }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as Rejection).reason).toBe('internalError');
  });
});

describe('uniqueEmail fixture', () => {
  it('is unique per call', () => {
    expect(uniqueEmail()).not.toBe(uniqueEmail());
    expect(TEST_PASSWORD.length).toBeGreaterThanOrEqual(10);
  });
});
