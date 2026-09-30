/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import { signInUser } from './users';
import { sessions, users } from './schema';
import {
  deleteSession,
  findLiveSessionUserId,
  insertSessionWithin,
  sweepExpiredSessions,
  touchSession,
} from './sessions';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { resetDatabase, createTestSession, createTestUser, closePool } from '@/test/db-fixtures';
import type { UserActor } from '@/lib/contracts/actor';

async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
}

function freshHash() {
  const token = generateRegisteredSessionToken();
  return { token, hash: hashRegisteredSessionToken(token) };
}

async function allSessionIds(): Promise<string[]> {
  return (await db.select({ id: sessions.id }).from(sessions)).map((row) => row.id);
}

/** Rewrites a timestamp column relative to the database's own clock. */
async function setAge(id: string, column: 'last_used_at' | 'expires_at' | 'created_at', interval: string): Promise<void> {
  await db.execute(sql.raw(`UPDATE fluentina.sessions SET ${column} = now() + interval '${interval}' WHERE id = '${id}'`));
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

describe('sessions.id stores the SHA-256 of the token, never the token', () => {
  it('the row\'s primary key is the hash; the raw token appears nowhere in the table', async () => {
    const actor = await newUserActor();
    const { token, hash } = freshHash();

    await createTestSession(actor, hash);

    expect(await allSessionIds()).toEqual([hash]);
    // Belt and braces: search every column of every row, as text, for the token.
    const dump = await db.execute(sql`SELECT s::text AS row FROM fluentina.sessions s`);
    expect(JSON.stringify(dump.rows)).not.toContain(token);
  });

  it('a lookup by the raw token finds nothing: only the hash authenticates', async () => {
    const actor = await newUserActor();
    const { token, hash } = freshHash();
    await createTestSession(actor, hash);

    // Deliberately defeating the brand: this is what a caller that forgot to hash would do.
    expect(await findLiveSessionUserId(token as never)).toBeNull();
    expect((await findLiveSessionUserId(hash))?.userId).toBe(actor.userId);
  });
});

describe('findLiveSessionUserId — expiry and idle timeout are enforced in SQL', () => {
  it('finds a fresh session and reports the user and when it was last used', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);

    const live = await findLiveSessionUserId(hash);
    expect(live?.userId).toBe(actor.userId);
    expect(live?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('finds nothing for an unknown hash', async () => {
    expect(await findLiveSessionUserId(freshHash().hash)).toBeNull();
  });

  it('sets absolute expiry 30 days out, on the database clock', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);

    const [row] = await db
      .select({ days: sql<number>`extract(epoch from (${sessions.expiresAt} - ${sessions.createdAt})) / 86400` })
      .from(sessions)
      .where(eq(sessions.id, hash));
    expect(Number(row.days)).toBeCloseTo(30, 3);
  });

  it('refuses a session past its absolute expiry, even though it was used a moment ago', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);
    await setAge(hash, 'expires_at', '-1 second');

    expect(await findLiveSessionUserId(hash)).toBeNull();
  });

  it('accepts a session used 13 days ago and refuses one used 15 days ago — the 14-day idle timeout', async () => {
    const actor = await newUserActor();
    const inside = freshHash();
    const outside = freshHash();
    await createTestSession(actor, inside.hash);
    await createTestSession(actor, outside.hash);
    await setAge(inside.hash, 'last_used_at', '-13 days');
    await setAge(outside.hash, 'last_used_at', '-15 days');

    expect(await findLiveSessionUserId(inside.hash)).not.toBeNull();
    // Absolute expiry is still 30 days away: this refusal is the idle condition alone.
    expect(await findLiveSessionUserId(outside.hash)).toBeNull();
  });

  it('a session idle-expired stays refused even if its absolute expiry is far in the future', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);
    await setAge(hash, 'last_used_at', '-14 days -1 minute');
    await setAge(hash, 'expires_at', '+29 days');

    expect(await findLiveSessionUserId(hash)).toBeNull();
  });
});

describe('touchSession — refresh last_used_at only when more than an hour stale', () => {
  async function lastUsed(id: string): Promise<Date> {
    const [row] = await db.select({ at: sessions.lastUsedAt }).from(sessions).where(eq(sessions.id, id));
    return row.at;
  }

  it('does not write when the session was used within the hour', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);
    await setAge(hash, 'last_used_at', '-30 minutes');
    const before = await lastUsed(hash);

    await touchSession(actor, hash);

    expect((await lastUsed(hash)).getTime()).toBe(before.getTime());
  });

  it('refreshes to now when the session is more than an hour stale', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);
    await setAge(hash, 'last_used_at', '-2 hours');
    const before = await lastUsed(hash);

    await touchSession(actor, hash);

    const after = await lastUsed(hash);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(Date.now() - after.getTime()).toBeLessThan(60_000);
  });

  it('does not touch another user\'s session', async () => {
    const owner = await newUserActor();
    const other = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(owner, hash);
    await setAge(hash, 'last_used_at', '-2 hours');
    const before = await lastUsed(hash);

    await touchSession(other, hash);

    expect((await lastUsed(hash)).getTime()).toBe(before.getTime());
  });
});

describe('deleteSession — scoped to the actor', () => {
  it('deletes the actor\'s own session and reports it', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(actor, hash);

    expect(await deleteSession(actor, hash)).toBe(true);
    expect(await findLiveSessionUserId(hash)).toBeNull();
    expect(await allSessionIds()).toEqual([]);
  });

  it('deletes nothing when the hash belongs to a different user', async () => {
    const owner = await newUserActor();
    const attacker = await newUserActor();
    const { hash } = freshHash();
    await createTestSession(owner, hash);

    expect(await deleteSession(attacker, hash)).toBe(false);
    expect((await findLiveSessionUserId(hash))?.userId).toBe(owner.userId);
  });

  it('reports false for a session that does not exist', async () => {
    expect(await deleteSession(await newUserActor(), freshHash().hash)).toBe(false);
  });
});

describe('sweepExpiredSessions — hung off creation, and never the thing correctness depends on', () => {
  it('deletes only rows past their absolute expiry', async () => {
    const actor = await newUserActor();
    const live = freshHash();
    const expired = freshHash();
    await insertSessionWithin(db, actor, live.hash);
    await insertSessionWithin(db, actor, expired.hash);
    await setAge(expired.hash, 'expires_at', '-1 minute');

    expect(await sweepExpiredSessions()).toBe(1);
    expect(await allSessionIds()).toEqual([live.hash]);
  });

  it('runs on session creation: signing in (the only sign-in path) removes an already-expired session', async () => {
    const actor = await newUserActor();
    const stale = freshHash();
    await insertSessionWithin(db, actor, stale.hash);
    await setAge(stale.hash, 'expires_at', '-1 day');

    const fresh = freshHash();
    await signInUser(actor, { guest: null, sessionTokenHash: fresh.hash, replacing: null });

    expect(await allSessionIds()).toEqual([fresh.hash]);
  });

  // The design keeps the sweep off the hot read path: creation is rare, reads
  // are constant, and correctness never depends on the sweep. "Runs on
  // creation" is pinned above; this pins the other half. Asserted two ways so a
  // sweep added by any route fails it: the row it would delete is still there,
  // and `db.delete` was never reached.
  it('does NOT run on reads: a lookup leaves an already-expired row in the table and issues no delete', async () => {
    const actor = await newUserActor();
    const stale = freshHash();
    const live = freshHash();
    await insertSessionWithin(db, actor, stale.hash);
    await insertSessionWithin(db, actor, live.hash);
    await setAge(stale.hash, 'expires_at', '-1 day');
    const deleteSpy = vi.spyOn(db, 'delete');

    try {
      expect((await findLiveSessionUserId(live.hash))?.userId).toBe(actor.userId);
      expect(await findLiveSessionUserId(stale.hash)).toBeNull();
      await touchSession(actor, live.hash);

      expect(deleteSpy).not.toHaveBeenCalled();
      expect((await allSessionIds()).sort()).toEqual([stale.hash, live.hash].sort());
    } finally {
      deleteSpy.mockRestore();
    }
  });

  it('an expired row is refused by the lookup whether or not any sweep has run', async () => {
    const actor = await newUserActor();
    const { hash } = freshHash();
    await insertSessionWithin(db, actor, hash);
    await setAge(hash, 'expires_at', '-1 minute');

    // No sweep has run: the row is still in the table...
    expect(await allSessionIds()).toEqual([hash]);
    // ...and still authenticates nobody.
    expect(await findLiveSessionUserId(hash)).toBeNull();
  });
});

describe('schema', () => {
  it('cascades: erasing the user erases their sessions', async () => {
    const actor = await newUserActor();
    await createTestSession(actor, freshHash().hash);

    await db.delete(users).where(eq(users.id, actor.userId));

    expect(await allSessionIds()).toEqual([]);
  });

  it('has the two indexes the design names (user_id, expires_at) alongside the primary key', async () => {
    const result = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'fluentina' AND tablename = 'sessions' ORDER BY indexname`,
    );
    expect(result.rows.map((row) => row.indexname)).toEqual(['sessions_expires_at_idx', 'sessions_pkey', 'sessions_user_id_idx']);
  });
});
