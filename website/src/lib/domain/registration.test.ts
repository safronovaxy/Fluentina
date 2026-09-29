/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { consentRecords, sessions, users } from '@/lib/db/schema';
import { createEssay, getEssayById } from '@/lib/db/essays';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { registerAccount } from './registration';
import { resolveOwnerActor } from './owner-actor';
import { verifyPassword } from './password';
import { hashRegisteredSessionToken } from './registered-session-token';
import { generateGuestSessionId } from './session-id';
import { registerRequestSchema } from '@/lib/contracts/auth';
import { CONSENT_KINDS } from '@/lib/contracts/consent';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import { TEST_PASSWORD, registerTestAccount, registrationBody } from '@/test/auth-fixtures';
import type { GuestActor } from '@/lib/contracts/actor';

const parse = (body: ReturnType<typeof registrationBody>) => registerRequestSchema.parse(body);

async function guestWithEssay(): Promise<{ guest: GuestActor; essayId: string }> {
  const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
  await createGuestSession(guest);
  const essay = await createEssay(guest, 'Ein Aufsatz, den der Gast vor der Registrierung geschrieben hat.');
  return { guest, essayId: essay.id };
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

describe('registerAccount', () => {
  it('stores a self-describing scrypt hash that verifies the password, never the password itself', async () => {
    const body = registrationBody({ email: 'ada@example.test', password: TEST_PASSWORD });

    await registerAccount(parse(body), { guestSessionId: null, presentedSessionToken: null });

    const [user] = await db.select().from(users);
    expect(user.email).toBe('ada@example.test');
    expect(user.passwordHash).toMatch(/^scrypt\$N=32768,r=8,p=1\$/);
    expect(user.passwordHash).not.toContain(TEST_PASSWORD);
    expect((await verifyPassword(TEST_PASSWORD, user.passwordHash)).valid).toBe(true);
  });

  it('stores the normalised email', async () => {
    await registerAccount(parse(registrationBody({ email: '  Ada.Lovelace@Example.TEST ' })), {
      guestSessionId: null,
      presentedSessionToken: null,
    });

    expect((await db.select().from(users))[0].email).toBe('ada.lovelace@example.test');
  });

  it('signs the new user in: the returned token\'s hash — never the token — is the session row', async () => {
    const outcome = await registerAccount(parse(registrationBody()), { guestSessionId: null, presentedSessionToken: null });
    if (outcome.status !== 'registered') throw new Error('expected registration');

    const rows = await db.select().from(sessions);
    expect(rows.map((row) => row.id)).toEqual([hashRegisteredSessionToken(outcome.token)]);
    expect(rows.map((row) => row.id)).not.toContain(outcome.token);
  });

  it('is not email-verified at registration: the timestamp is null, and registration does not wait for it', async () => {
    const outcome = await registerAccount(parse(registrationBody()), { guestSessionId: null, presentedSessionToken: null });

    expect(outcome.status).toBe('registered'); // signed in immediately (Irina, 2026-09-29)
    expect((await db.select().from(users))[0].emailVerifiedAt).toBeNull();
  });

  it('threads the versions the request presented into the consent rows — no constant is stamped on at insert time', async () => {
    const body = registrationBody();
    const request = parse(body);
    // The schema only lets the version in force through; here the domain is
    // handed other values directly to prove it records what it is GIVEN.
    const presented = {
      ...request,
      consent: Object.fromEntries(
        CONSENT_KINDS.map((kind) => [kind, { ...request.consent[kind], version: `2031-01-0${CONSENT_KINDS.indexOf(kind) + 1}` }]),
      ),
    } as unknown as typeof request;

    await registerAccount(presented, { guestSessionId: null, presentedSessionToken: null });

    const rows = await db.select().from(consentRecords);
    for (const [index, kind] of CONSENT_KINDS.entries()) {
      expect(rows.find((row) => row.kind === kind)?.documentVersion).toBe(`2031-01-0${index + 1}`);
    }
  });

  it('writes the marketing row when unticked, granted=false, and granted=true when ticked', async () => {
    await registerAccount(parse(registrationBody({ marketing: false })), { guestSessionId: null, presentedSessionToken: null });
    await registerAccount(parse(registrationBody({ marketing: true })), { guestSessionId: null, presentedSessionToken: null });

    const marketing = (await db.select().from(consentRecords)).filter((row) => row.kind === 'marketingEmail');
    expect(marketing.map((row) => row.granted).sort()).toEqual([false, true]);
  });

  it('reports emailAlreadyRegistered for a taken address — the enumeration oracle auto-login makes unavoidable — and keeps the first account intact', async () => {
    const first = await registerTestAccount({ email: 'taken@example.test' });

    const second = await registerAccount(parse(registrationBody({ email: 'TAKEN@example.test' })), {
      guestSessionId: null,
      presentedSessionToken: null,
    });

    expect(second).toEqual({ status: 'emailAlreadyRegistered' });
    expect(await db.select().from(users)).toHaveLength(1);
    expect((await db.select().from(users).where(eq(users.id, first.userId)))[0].email).toBe('taken@example.test');
  });

  describe('the guest becomes the user', () => {
    it('after registering, the new session owns the guest\'s essay and the old guest cookie owns nothing', async () => {
      const { guest, essayId } = await guestWithEssay();

      const outcome = await registerAccount(parse(registrationBody()), { guestSessionId: guest.sessionId, presentedSessionToken: null });
      if (outcome.status !== 'registered') throw new Error('expected registration');

      // The real resolver, fed the new session cookie AND the stale guest cookie
      // together — the exact pair a browser holds until the guest cookie is cleared.
      const cookies: Record<string, string> = {
        [REGISTERED_SESSION_COOKIE_NAME]: outcome.token,
        [GUEST_SESSION_COOKIE_NAME]: guest.sessionId,
      };
      const actor = await resolveOwnerActor((name) => cookies[name]);
      expect(actor?.kind).toBe('user');
      expect((await getEssayById(actor!, essayId))?.id).toBe(essayId);
      // The stale guest cookie on its own authorises nothing.
      expect(await getEssayById(guest, essayId)).toBeNull();
    });

    it('a registration with no guest cookie still succeeds', async () => {
      expect((await registerAccount(parse(registrationBody()), { guestSessionId: null, presentedSessionToken: null })).status).toBe('registered');
    });
  });

  it('replaces a session the request already carried: the old row is deleted, not promoted', async () => {
    const previous = await registerTestAccount();
    const [previousRow] = await db.select().from(sessions);

    const outcome = await registerAccount(parse(registrationBody()), { guestSessionId: null, presentedSessionToken: previous.token });
    if (outcome.status !== 'registered') throw new Error('expected registration');

    const ids = (await db.select().from(sessions)).map((row) => row.id);
    expect(ids).not.toContain(previousRow.id);
    expect(ids).toEqual([hashRegisteredSessionToken(outcome.token)]);
  });

  it('a registration that fails (taken address) leaves the session the request carried alone', async () => {
    const existing = await registerTestAccount({ email: 'taken@example.test' });

    await registerAccount(parse(registrationBody({ email: 'taken@example.test' })), {
      guestSessionId: null,
      presentedSessionToken: existing.token,
    });

    expect((await db.select().from(sessions)).map((row) => row.id)).toEqual([hashRegisteredSessionToken(existing.token)]);
  });
});
