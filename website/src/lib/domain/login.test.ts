/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { findUserForLogin } from '@/lib/db/users';
import { createSession } from '@/lib/db/sessions';
import { login } from './login';
import { verifyPassword } from './password';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { loginRequestSchema } from '@/lib/contracts/auth';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { TEST_PASSWORD, registerTestAccount, uniqueEmail } from '@/test/auth-fixtures';

// Counts real scrypt derivations while still running them: this file's whole
// point is "how many times did the expensive thing run on this path".
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, scrypt: vi.fn(actual.scrypt), timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const scryptCalls = () => vi.mocked(scrypt).mock.calls.length;
const comparisons = () => vi.mocked(timingSafeEqual).mock.calls.length;

const request = (email: string, password: string) => loginRequestSchema.parse({ email, password });

async function sessionRows() {
  return db.select().from(sessions);
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(() => {
  vi.mocked(scrypt).mockClear();
  vi.mocked(timingSafeEqual).mockClear();
});

afterEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closePool();
});

describe('login performs exactly ONE scrypt verification on every path', () => {
  it('unknown email: verifies against the dummy hash — one derivation, not zero', async () => {
    const outcome = await login(request('nobody@example.test', TEST_PASSWORD), null);

    expect(outcome).toEqual({ status: 'invalidCredentials' });
    expect(scryptCalls()).toBe(1);
  });

  it('known email, wrong password: one derivation', async () => {
    const account = await registerTestAccount();
    vi.mocked(scrypt).mockClear();

    const outcome = await login(request(account.email, 'not the password'), null);

    expect(outcome).toEqual({ status: 'invalidCredentials' });
    expect(scryptCalls()).toBe(1);
  });

  it('known email, right password: one derivation (current parameters, so nothing to rehash)', async () => {
    const account = await registerTestAccount();
    vi.mocked(scrypt).mockClear();

    const outcome = await login(request(account.email, account.password), null);

    expect(outcome.status).toBe('signedIn');
    expect(scryptCalls()).toBe(1);
  });

  it('unknown email and wrong password are indistinguishable in outcome: same status, same shape, no token', async () => {
    const account = await registerTestAccount();

    const unknown = await login(request('nobody@example.test', 'not the password'), null);
    const wrong = await login(request(account.email, 'not the password'), null);

    expect(unknown).toEqual(wrong);
    expect(Object.keys(unknown)).toEqual(['status']);
  });

  it('compares with crypto.timingSafeEqual — once per verification, on the dummy path too — never with ===', async () => {
    const account = await registerTestAccount();
    vi.mocked(timingSafeEqual).mockClear();

    await login(request('nobody@example.test', TEST_PASSWORD), null);
    expect(comparisons()).toBe(1);
    await login(request(account.email, 'not the password'), null);
    expect(comparisons()).toBe(2);
    await login(request(account.email, account.password), null);
    expect(comparisons()).toBe(3);
  });

  it('an unknown email creates no session and no user', async () => {
    await login(request('nobody@example.test', TEST_PASSWORD), null);

    expect(await sessionRows()).toEqual([]);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('a failed login of a REAL account creates no session either', async () => {
    const account = await registerTestAccount();
    const before = (await sessionRows()).length;

    await login(request(account.email, 'not the password'), null);

    expect(await sessionRows()).toHaveLength(before);
  });
});

describe('a successful login', () => {
  it('signs in, storing the HASH of the returned token as the session id', async () => {
    const account = await registerTestAccount();
    await db.delete(sessions);

    const outcome = await login(request(account.email, account.password), null);
    if (outcome.status !== 'signedIn') throw new Error('expected sign-in');

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashRegisteredSessionToken(outcome.token));
    expect(rows[0].id).not.toBe(outcome.token);
    expect(rows[0].userId).toBe(account.userId);
  });

  it('finds the account whatever the case or padding of the address typed', async () => {
    const account = await registerTestAccount({ email: 'Mixed.Case@Example.test' });

    const outcome = await login(request('  MIXED.CASE@EXAMPLE.TEST ', account.password), null);

    expect(outcome.status).toBe('signedIn');
  });

  describe('fixation: login ROTATES the session', () => {
    it('deletes the session the request carried and issues a different one', async () => {
      const account = await registerTestAccount();
      const before = await sessionRows();
      expect(before).toHaveLength(1);
      const oldHash = before[0].id;

      const outcome = await login(request(account.email, account.password), account.token);
      if (outcome.status !== 'signedIn') throw new Error('expected sign-in');

      const after = await sessionRows();
      // The old credential is gone from the database, not merely superseded...
      expect(after.map((row) => row.id)).not.toContain(oldHash);
      // ...and exactly one row remains: a fresh one, under a fresh token.
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(hashRegisteredSessionToken(outcome.token));
      expect(outcome.token).not.toBe(account.token);
    });

    it('never promotes an existing row: the new row is an insert with its own creation time and id', async () => {
      const account = await registerTestAccount();
      const [old] = await sessionRows();

      const outcome = await login(request(account.email, account.password), account.token);
      if (outcome.status !== 'signedIn') throw new Error('expected sign-in');

      const [fresh] = await sessionRows();
      expect(fresh.id).not.toBe(old.id);
      expect(fresh.createdAt.getTime()).toBeGreaterThanOrEqual(old.createdAt.getTime());
    });

    it('also deletes a presented session that belonged to a DIFFERENT account — whoever is signing in replaces what the browser held', async () => {
      const previous = await registerTestAccount();
      const account = await registerTestAccount();

      await login(request(account.email, account.password), previous.token);

      const owners = (await sessionRows()).map((row) => row.userId);
      expect(owners).toContain(account.userId);
      // previous's own session row is gone; only `account`'s original and the new one remain.
      expect(owners.filter((id) => id === previous.userId)).toEqual([]);
    });

    it('does not delete the presented session when the credentials are wrong', async () => {
      const account = await registerTestAccount();

      await login(request(account.email, 'not the password'), account.token);

      expect(await sessionRows()).toHaveLength(1);
    });

    it('a presented token that names no live session is simply ignored', async () => {
      const account = await registerTestAccount();

      const outcome = await login(request(account.email, account.password), generateRegisteredSessionToken());

      expect(outcome.status).toBe('signedIn');
    });
  });
});

describe('rehash on successful login with stale parameters', () => {
  /** A user whose hash was written with N=2^14, built independently of the module under test. */
  async function userWithStaleHash(password: string) {
    const email = uniqueEmail();
    const salt = randomBytes(16);
    const key = scryptSync(password, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const stale = `scrypt$N=16384,r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`;
    const [row] = await db.insert(users).values({ email, passwordHash: stale }).returning({ id: users.id });
    return { email, id: row.id, stale };
  }

  it('rewrites the stored hash with current parameters, in place, and the same password keeps working', async () => {
    const user = await userWithStaleHash(TEST_PASSWORD);
    vi.mocked(scrypt).mockClear();

    const outcome = await login(request(user.email, TEST_PASSWORD), null);

    expect(outcome.status).toBe('signedIn');
    // Verify with the stored (old) parameters, then hash again with the current ones.
    expect(scryptCalls()).toBe(2);
    const stored = (await findUserForLogin(request(user.email, 'x').email))?.passwordHash;
    expect(stored).not.toBe(user.stale);
    expect(stored).toMatch(/^scrypt\$N=32768,r=8,p=1\$/);
    expect((await verifyPassword(TEST_PASSWORD, stored!)).valid).toBe(true);
    // The row is the same row: updated, not replaced.
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
  });

  it('is a one-off: the next login on the upgraded hash does one derivation', async () => {
    const user = await userWithStaleHash(TEST_PASSWORD);
    await login(request(user.email, TEST_PASSWORD), null);
    vi.mocked(scrypt).mockClear();

    await login(request(user.email, TEST_PASSWORD), null);

    expect(scryptCalls()).toBe(1);
  });

  it('does NOT rehash on a failed login: a wrong password proves nothing and costs one derivation', async () => {
    const user = await userWithStaleHash(TEST_PASSWORD);
    vi.mocked(scrypt).mockClear();

    const outcome = await login(request(user.email, 'not the password'), null);

    expect(outcome).toEqual({ status: 'invalidCredentials' });
    expect(scryptCalls()).toBe(1);
    expect((await findUserForLogin(request(user.email, 'x').email))?.passwordHash).toBe(user.stale);
  });

  it('a rehash that fails does not fail the login the person just earned', async () => {
    const user = await userWithStaleHash(TEST_PASSWORD);
    const update = vi.spyOn(db, 'update').mockImplementation(() => {
      throw new Error('write failed');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await login(request(user.email, TEST_PASSWORD), null);

    expect(outcome.status).toBe('signedIn');
    expect(update).toHaveBeenCalled();
  });
});

describe('a fixture user with an unparseable hash', () => {
  it('fails loudly rather than answering "wrong password" — a corrupt row is not a credentials problem', async () => {
    const userId = await createTestUser();
    const [row] = await db.select().from(users).where(eq(users.id, userId));

    await expect(login(request(row.email, TEST_PASSWORD), null)).rejects.toThrow();
  });
});

describe('sessions the sweep leaves alone', () => {
  it('sweeping on sign-in removes an expired session but never a live one', async () => {
    const account = await registerTestAccount();
    const expired = hashRegisteredSessionToken(generateRegisteredSessionToken());
    await createSession({ kind: 'user', userId: account.userId }, expired);
    await db.execute(sql`UPDATE fluentina.sessions SET expires_at = now() - interval '1 day' WHERE id = ${expired}`);

    await login(request(account.email, account.password), null);

    const ids = (await sessionRows()).map((row) => row.id);
    expect(ids).not.toContain(expired);
    expect(ids).toHaveLength(2); // registration's session + this login's
  });
});
