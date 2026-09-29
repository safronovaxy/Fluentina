/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { consentRecords, essays, guestSessions, sessions, users } from './schema';
import { createEssay, getEssayById } from './essays';
import { createGuestSession, getGuestSessionById } from './guest-sessions';
import { createSession, findLiveSessionUserId } from './sessions';
import {
  findUserForLogin,
  isEmailUniqueViolation,
  registerUser,
  replacePasswordHash,
  type RegisterUserInput,
} from './users';
import type { ConsentDecision } from './consent-records';
import { emailSchema } from '@/lib/contracts/auth';
import { CONSENT_KINDS, CURRENT_CONSENT_VERSIONS } from '@/lib/contracts/consent';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

const HASH = 'scrypt$N=32768,r=8,p=1$c2FsdA==$aGFzaA==';

function consent(marketing = false): ConsentDecision[] {
  return CONSENT_KINDS.map((kind) => ({
    kind,
    documentVersion: CURRENT_CONSENT_VERSIONS[kind],
    granted: kind === 'marketingEmail' ? marketing : true,
  }));
}

function input(overrides: Partial<RegisterUserInput> = {}): RegisterUserInput {
  return {
    email: emailSchema.parse(`u-${Math.random().toString(36).slice(2)}@example.test`),
    passwordHash: HASH,
    consent: consent(),
    guest: null,
    sessionTokenHash: hashRegisteredSessionToken(generateRegisteredSessionToken()),
    replacing: null,
    ...overrides,
  };
}

async function newGuest(): Promise<GuestActor> {
  const actor: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
  await createGuestSession(actor);
  return actor;
}

async function count(table: typeof users | typeof sessions | typeof consentRecords): Promise<number> {
  return (await db.select().from(table)).length;
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

describe('registerUser — the one transaction', () => {
  it('writes the user, four consent rows, and a session, and reports the new id', async () => {
    const request = input();

    const result = await registerUser(request);

    expect(result.status).toBe('registered');
    if (result.status !== 'registered') return;
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user.email).toBe(request.email);
    expect(user.passwordHash).toBe(HASH);
    // A timestamp, not a boolean, and null until KAN-51 verifies it.
    expect(user.emailVerifiedAt).toBeNull();
    expect(await db.select().from(consentRecords).where(eq(consentRecords.userId, result.userId))).toHaveLength(4);
    expect((await findLiveSessionUserId(request.sessionTokenHash))?.userId).toBe(result.userId);
  });

  it('converts the guest session and its essays to the new user in the same transaction', async () => {
    const guest = await newGuest();
    const essay = await createEssay(guest, 'Ein Aufsatz, den ein Gast vor der Registrierung geschrieben hat.');

    const result = await registerUser(input({ guest }));

    expect(result).toMatchObject({ status: 'registered', guestConversion: 'converted' });
    if (result.status !== 'registered') return;
    const user: UserActor = { kind: 'user', userId: result.userId };
    expect((await getEssayById(user, essay.id))?.id).toBe(essay.id);
    // The old guest identity stops authorising reads the moment the transaction commits.
    expect(await getEssayById(guest, essay.id)).toBeNull();
  });

  describe('nothingToConvert is a normal outcome, not an error', () => {
    it('no guest cookie at all', async () => {
      expect(await registerUser(input({ guest: null }))).toMatchObject({ status: 'registered', guestConversion: 'nothingToConvert' });
    });

    it('a well-formed guest id whose row was never created', async () => {
      const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
      expect(await registerUser(input({ guest }))).toMatchObject({ status: 'registered', guestConversion: 'nothingToConvert' });
    });

    it('a guest session that already converted — registering twice from two tabs', async () => {
      const guest = await newGuest();
      const essay = await createEssay(guest, 'Ein Aufsatz, der nur einmal umgezogen werden darf.');
      const first = await registerUser(input({ guest }));
      const second = await registerUser(input({ guest }));

      expect(second).toMatchObject({ status: 'registered', guestConversion: 'nothingToConvert' });
      // The essay stays with the first user; the second registration did not steal it.
      if (first.status !== 'registered' || second.status !== 'registered') throw new Error('unexpected');
      expect(await getEssayById({ kind: 'user', userId: first.userId }, essay.id)).not.toBeNull();
      expect(await getEssayById({ kind: 'user', userId: second.userId }, essay.id)).toBeNull();
    });

    it('a guest session retention already deleted', async () => {
      const guest = await newGuest();
      await db.delete(guestSessions).where(eq(guestSessions.id, guest.sessionId));

      expect(await registerUser(input({ guest }))).toMatchObject({ status: 'registered', guestConversion: 'nothingToConvert' });
    });
  });

  describe('consent — append-only rows, one per kind, marketing included', () => {
    it('writes the marketing row when the box is unticked, with granted = false: evidence the choice was presented and declined', async () => {
      const result = await registerUser(input({ consent: consent(false) }));
      if (result.status !== 'registered') throw new Error('unexpected');

      const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, result.userId));
      const marketing = rows.filter((row) => row.kind === 'marketingEmail');
      expect(marketing).toHaveLength(1);
      expect(marketing[0].granted).toBe(false);
    });

    it('writes marketing granted = true when ticked, independently of the other three', async () => {
      const result = await registerUser(input({ consent: consent(true) }));
      if (result.status !== 'registered') throw new Error('unexpected');

      const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, result.userId));
      expect(rows.find((row) => row.kind === 'marketingEmail')?.granted).toBe(true);
    });

    it('records one row per kind, each with its own version and a timestamp', async () => {
      const result = await registerUser(input());
      if (result.status !== 'registered') throw new Error('unexpected');

      const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, result.userId));
      expect(rows.map((row) => row.kind).sort()).toEqual([...CONSENT_KINDS].sort());
      for (const row of rows) {
        expect(row.documentVersion).toBe(CURRENT_CONSENT_VERSIONS[row.kind as keyof typeof CURRENT_CONSENT_VERSIONS]);
        expect(row.recordedAt).toBeInstanceOf(Date);
      }
    });

    it('stores the version it was GIVEN, not a constant stamped on at insert time', async () => {
      const presented = consent().map((decision) => ({ ...decision, documentVersion: '2099-12-31-v2' }));
      const result = await registerUser(input({ consent: presented }));
      if (result.status !== 'registered') throw new Error('unexpected');

      const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, result.userId));
      expect(new Set(rows.map((row) => row.documentVersion))).toEqual(new Set(['2099-12-31-v2']));
    });
  });

  describe('atomicity', () => {
    it('rolls back WHOLLY when the session insert fails after the conversion has already run', async () => {
      const guest = await newGuest();
      const essay = await createEssay(guest, 'Ein Aufsatz, der nicht verloren gehen darf, wenn die Anmeldung scheitert.');
      // A live session that already owns the hash this registration will try to
      // insert: the session INSERT (the LAST statement) fails on its primary key,
      // AFTER the user, the consent rows and the conversion have all executed.
      const collidingHash = hashRegisteredSessionToken(generateRegisteredSessionToken());
      await createSession({ kind: 'user', userId: await createTestUser() }, collidingHash);
      const usersBefore = await count(users);
      const sessionsBefore = await count(sessions);

      await expect(registerUser(input({ guest, sessionTokenHash: collidingHash }))).rejects.toThrow();

      // No new account, no consent rows, no session...
      expect(await count(users)).toBe(usersBefore);
      expect(await count(consentRecords)).toBe(0);
      expect(await count(sessions)).toBe(sessionsBefore);
      // ...and, the dangerous one: the conversion did NOT commit. The guest
      // session is still unconverted and the essay is still reachable by its
      // guest — not stranded under a user id nobody is signed in as.
      const sessionAfter = await getGuestSessionById(guest, guest.sessionId);
      expect(sessionAfter?.userId).toBeNull();
      expect(sessionAfter?.convertedAt).toBeNull();
      expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
      const [essayRow] = await db.select().from(essays).where(eq(essays.id, essay.id));
      expect(essayRow.userId).toBeNull();
    });

    it('also rolls back the deletion of the replaced session when a later statement fails', async () => {
      const previousUser: UserActor = { kind: 'user', userId: await createTestUser() };
      const previous = hashRegisteredSessionToken(generateRegisteredSessionToken());
      await createSession(previousUser, previous);
      const colliding = hashRegisteredSessionToken(generateRegisteredSessionToken());
      await createSession(previousUser, colliding);

      await expect(
        registerUser(input({ sessionTokenHash: colliding, replacing: { actor: previousUser, tokenHash: previous } })),
      ).rejects.toThrow();

      expect(await findLiveSessionUserId(previous)).not.toBeNull();
    });

    it('deletes the presented session and inserts a fresh one — never promotes the old row', async () => {
      const previousUser: UserActor = { kind: 'user', userId: await createTestUser() };
      const previous = hashRegisteredSessionToken(generateRegisteredSessionToken());
      await createSession(previousUser, previous);
      const request = input({ replacing: { actor: previousUser, tokenHash: previous } });

      const result = await registerUser(request);
      if (result.status !== 'registered') throw new Error('unexpected');

      expect(await findLiveSessionUserId(previous)).toBeNull();
      expect((await findLiveSessionUserId(request.sessionTokenHash))?.userId).toBe(result.userId);
    });
  });

  describe('a duplicate email', () => {
    it('is reported as emailAlreadyRegistered, and the loser leaves nothing behind', async () => {
      const first = input();
      await registerUser(first);
      const guest = await newGuest();
      const essay = await createEssay(guest, 'Ein Aufsatz, der bei einer doppelten Registrierung nicht wandern darf.');

      const second = await registerUser(input({ email: first.email, guest }));

      expect(second).toEqual({ status: 'emailAlreadyRegistered' });
      expect(await count(users)).toBe(1);
      expect(await count(consentRecords)).toBe(4);
      expect(await count(sessions)).toBe(1);
      // The guest was not converted by the failed attempt.
      expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
    });

    it('is decided by the constraint name, not by any unique violation: a session-hash collision is a real error', async () => {
      const collidingHash = hashRegisteredSessionToken(generateRegisteredSessionToken());
      await createSession({ kind: 'user', userId: await createTestUser() }, collidingHash);

      // 23505 again — but on sessions_pkey. Reporting it as "email taken" would be a lie.
      await expect(registerUser(input({ sessionTokenHash: collidingHash }))).rejects.toThrow();
    });

    it('two simultaneous registrations of one address: exactly one wins, the other is told the email is taken', async () => {
      const email = emailSchema.parse('race@example.test');

      const results = await Promise.all([registerUser(input({ email })), registerUser(input({ email }))]);

      expect(results.map((r) => r.status).sort()).toEqual(['emailAlreadyRegistered', 'registered']);
      expect(await count(users)).toBe(1);
      expect(await count(sessions)).toBe(1);
    });
  });
});

describe('isEmailUniqueViolation — SQLSTATE 23505 plus the constraint name, through .cause', () => {
  const pgError = (code: string, constraint: string) => ({ code, constraint });

  it('matches the driver error as Drizzle wraps it: the SQLSTATE and constraint one level down, on .cause', () => {
    expect(isEmailUniqueViolation({ code: undefined, cause: pgError('23505', 'users_email_unique') })).toBe(true);
  });

  it('matches an unwrapped driver error too', () => {
    expect(isEmailUniqueViolation(pgError('23505', 'users_email_unique'))).toBe(true);
  });

  it('does not match a unique violation on another constraint', () => {
    expect(isEmailUniqueViolation({ cause: pgError('23505', 'sessions_pkey') })).toBe(false);
  });

  it('does not match the right constraint name under a different SQLSTATE', () => {
    expect(isEmailUniqueViolation({ cause: pgError('23503', 'users_email_unique') })).toBe(false);
  });

  it('does not match a bare 23505 with no constraint, and never reads `detail`', () => {
    expect(isEmailUniqueViolation({ cause: { code: '23505' } })).toBe(false);
    expect(isEmailUniqueViolation({ cause: { code: '23505', detail: 'Key (email)=(a@b.c) already exists.' } })).toBe(false);
  });

  it.each([null, undefined, 'users_email_unique', 42, new Error('duplicate key value violates unique constraint "users_email_unique"')])(
    'does not match %s',
    (value) => {
      expect(isEmailUniqueViolation(value)).toBe(false);
    },
  );

  it('matches what a REAL duplicate insert throws, after the query-error sanitiser has scrubbed it', async () => {
    await registerUser(input({ email: emailSchema.parse('real@example.test') }));
    let caught: unknown;
    try {
      await db.insert(users).values({ email: 'real@example.test', passwordHash: HASH });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isEmailUniqueViolation(caught)).toBe(true);
    // And the sanitiser really did strip `detail`, so nothing here could have parsed it.
    expect((caught as { cause?: { detail?: unknown } }).cause?.detail).toBeUndefined();
  });
});

describe('findUserForLogin', () => {
  it('returns exactly the id and the password hash — a login path cannot become a user-data read', async () => {
    const request = input({ email: emailSchema.parse('login@example.test') });
    const registered = await registerUser(request);
    if (registered.status !== 'registered') throw new Error('unexpected');

    const found = await findUserForLogin(request.email);

    expect(found).toEqual({ id: registered.userId, passwordHash: HASH });
    expect(Object.keys(found ?? {}).sort()).toEqual(['id', 'passwordHash']);
  });

  it('returns null for an address with no account', async () => {
    expect(await findUserForLogin(emailSchema.parse('nobody@example.test'))).toBeNull();
  });

  it('finds the account whatever the case of the address it is given, because the schema normalises before the lookup', async () => {
    await registerUser(input({ email: emailSchema.parse('Mixed.Case@Example.TEST') }));
    expect(await findUserForLogin(emailSchema.parse('  MIXED.CASE@example.test '))).not.toBeNull();
  });
});

describe('replacePasswordHash — compare-and-swap for rehash-on-login', () => {
  it('writes the new hash when the stored one is still the expected one', async () => {
    const request = input();
    const registered = await registerUser(request);
    if (registered.status !== 'registered') throw new Error('unexpected');
    const actor: UserActor = { kind: 'user', userId: registered.userId };

    expect(await replacePasswordHash(actor, HASH, 'scrypt$N=65536,r=8,p=1$c2FsdA==$bmV3')).toBe(true);
    expect((await findUserForLogin(request.email))?.passwordHash).toBe('scrypt$N=65536,r=8,p=1$c2FsdA==$bmV3');
  });

  it('does not overwrite a hash something else changed in the meantime', async () => {
    const request = input();
    const registered = await registerUser(request);
    if (registered.status !== 'registered') throw new Error('unexpected');
    const actor: UserActor = { kind: 'user', userId: registered.userId };

    expect(await replacePasswordHash(actor, 'a-stale-expectation', 'scrypt$N=65536,r=8,p=1$c2FsdA==$bmV3')).toBe(false);
    expect((await findUserForLogin(request.email))?.passwordHash).toBe(HASH);
  });

  it('is scoped to the actor\'s own row', async () => {
    const request = input();
    await registerUser(request);
    const other: UserActor = { kind: 'user', userId: await createTestUser() };

    expect(await replacePasswordHash(other, HASH, 'scrypt$N=65536,r=8,p=1$c2FsdA==$bmV3')).toBe(false);
    expect((await findUserForLogin(request.email))?.passwordHash).toBe(HASH);
  });
});
