/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { createSession } from '@/lib/db/sessions';
import { endRegisteredSession, resolveRegisteredSession } from './registered-session';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { generateGuestSessionId } from './session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { RegisteredSessionToken } from '@/lib/contracts/actor';

/**
 * The real lookup, against a real database. The three suites that `vi.mock`
 * this module (owner-actor, the grading route, the preview page) stay green
 * whether or not any of this works — this file is what covers it.
 */
async function signedIn(): Promise<{ userId: string; token: RegisteredSessionToken }> {
  const userId = await createTestUser();
  const token = generateRegisteredSessionToken();
  await createSession({ kind: 'user', userId }, hashRegisteredSessionToken(token));
  return { userId, token };
}

const cookie = (value: string | undefined) => (name: string) => (name === REGISTERED_SESSION_COOKIE_NAME ? value : undefined);

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

describe('resolveRegisteredSession', () => {
  it('turns a live session cookie into the user it belongs to', async () => {
    const { userId, token } = await signedIn();

    expect(await resolveRegisteredSession(cookie(token))).toEqual({ kind: 'user', userId });
  });

  it('reads only the registered-session cookie: a guest cookie value is not a session', async () => {
    await signedIn();
    const reader = (name: string) => (name === '__Host-fluentina_guest_session' ? generateGuestSessionId() : undefined);

    expect(await resolveRegisteredSession(reader)).toBeNull();
  });

  it('finds nothing for a missing cookie, without touching the database', async () => {
    const select = vi.spyOn(db, 'select');
    expect(await resolveRegisteredSession(cookie(undefined))).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it.each([['a guest-length value', 'a'.repeat(32)], ['non-hex', 'z'.repeat(64)], ['uppercase', 'A'.repeat(64)], ['empty', '']])(
    'finds nothing for a malformed cookie (%s), without touching the database',
    async (_label, value) => {
      const select = vi.spyOn(db, 'select');
      expect(await resolveRegisteredSession(cookie(value))).toBeNull();
      expect(select).not.toHaveBeenCalled();
    },
  );

  it('finds nothing for a well-formed token that names no session — a cookie cannot conjure one', async () => {
    await signedIn();
    expect(await resolveRegisteredSession(cookie(generateRegisteredSessionToken()))).toBeNull();
  });

  it('finds nothing once the session has passed its absolute expiry', async () => {
    const { token } = await signedIn();
    await db.execute(sql`UPDATE fluentina.sessions SET expires_at = now() - interval '1 second'`);

    expect(await resolveRegisteredSession(cookie(token))).toBeNull();
  });

  it('finds nothing once the session has been idle for more than 14 days', async () => {
    const { token } = await signedIn();
    await db.execute(sql`UPDATE fluentina.sessions SET last_used_at = now() - interval '15 days'`);

    expect(await resolveRegisteredSession(cookie(token))).toBeNull();
  });

  describe('refreshing last_used_at', () => {
    async function lastUsedMsAgo(token: RegisteredSessionToken): Promise<number> {
      const [row] = await db
        .select({ at: sessions.lastUsedAt })
        .from(sessions)
        .where(eq(sessions.id, hashRegisteredSessionToken(token)));
      return Date.now() - row.at.getTime();
    }

    it('does not write on a session used within the hour: one authenticated request is not one write', async () => {
      const { token } = await signedIn();
      await db.execute(sql`UPDATE fluentina.sessions SET last_used_at = now() - interval '30 minutes'`);
      const update = vi.spyOn(db, 'update');

      await resolveRegisteredSession(cookie(token));

      expect(update).not.toHaveBeenCalled();
      expect(await lastUsedMsAgo(token)).toBeGreaterThan(29 * 60 * 1000);
    });

    it('refreshes a session that is more than an hour stale', async () => {
      const { token } = await signedIn();
      await db.execute(sql`UPDATE fluentina.sessions SET last_used_at = now() - interval '2 hours'`);

      await resolveRegisteredSession(cookie(token));

      expect(await lastUsedMsAgo(token)).toBeLessThan(60_000);
    });

    it('a failed refresh does not fail the request: the session still resolves', async () => {
      const { userId, token } = await signedIn();
      await db.execute(sql`UPDATE fluentina.sessions SET last_used_at = now() - interval '2 hours'`);
      vi.spyOn(db, 'update').mockImplementation(() => {
        throw new Error('write failed');
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(await resolveRegisteredSession(cookie(token))).toEqual({ kind: 'user', userId });
    });
  });
});

describe('endRegisteredSession — logout deletes the row', () => {
  it('deletes the session row, after which the same token authenticates nobody', async () => {
    const { token } = await signedIn();
    expect(await resolveRegisteredSession(cookie(token))).not.toBeNull();

    await endRegisteredSession(token);

    expect(await db.select().from(sessions)).toEqual([]);
    expect(await resolveRegisteredSession(cookie(token))).toBeNull();
  });

  it('deletes only the session presented, leaving the same user\'s other sessions signed in', async () => {
    const { userId, token } = await signedIn();
    const other = generateRegisteredSessionToken();
    await createSession({ kind: 'user', userId }, hashRegisteredSessionToken(other));

    await endRegisteredSession(token);

    expect(await resolveRegisteredSession(cookie(other))).toEqual({ kind: 'user', userId });
  });

  it('is not an error for a token that names no session', async () => {
    await expect(endRegisteredSession(generateRegisteredSessionToken())).resolves.toBeUndefined();
  });
});
