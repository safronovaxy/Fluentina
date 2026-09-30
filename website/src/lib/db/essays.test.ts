/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { essays, guestSessions } from './schema';
import { createEssay, getEssayById, getEssayByIdUnscoped } from './essays';
import { createGuestSession, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

// A real users row: essays.user_id/guest_sessions.user_id both FK to it.
async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
}

// The stored columns, not the `Essay` the repository hands back: KAN-52's whole
// point is WHICH of the two owner columns a row carries, and an assertion that
// only read the mapped object through an ownership-scoped read would pass for
// a row that satisfied both branches.
async function rawEssayRow(id: string) {
  const [row] = await db.select().from(essays).where(eq(essays.id, id));
  return row;
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

describe('createEssay', () => {
  it('persists the essay under the creating guest session, unattached to any user', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);

    const essay = await createEssay(actor, 'The content of a freshly created essay.');

    expect(essay.sessionId).toBe(actor.sessionId);
    expect(essay.userId).toBeNull();
    expect(essay.content).toBe('The content of a freshly created essay.');
    // The guest-unconverted legal state, in the stored row: session set, user NULL.
    const row = await rawEssayRow(essay.id);
    expect(row.sessionId).toBe(actor.sessionId);
    expect(row.userId).toBeNull();
  });

  it('attaches the essay to the user rather than orphaning it, when the write arrives on a session that already converted', async () => {
    // A request still carrying the pre-conversion session id/cookie —
    // stale, but not forged: the session row still exists, so without the
    // fix the insert would succeed with user_id left null. The account
    // that wrote it could never read it again, but the stale guest session
    // still could — the exact leak this story exists to close.
    const actor = newGuestActor();
    await createGuestSession(actor);
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);

    const essay = await createEssay(actor, 'Written by a request that still has the old session id.');

    expect(essay.userId).toBe(user.userId);
    // KAN-52, the edge that fires the CHECK in production if missed: the
    // stale-cookie insert must write the ACCOUNT as owner and leave
    // `session_id` NULL. Copying `session.userId` while ALSO writing
    // `actor.sessionId` would set both columns and this insert would throw.
    expect(essay.sessionId).toBeNull();
    const row = await rawEssayRow(essay.id);
    expect(row.sessionId).toBeNull();
    expect(row.userId).toBe(user.userId);
    const readAsConvertedUser = await getEssayById(user, essay.id);
    const readAsStaleGuestSession = await getEssayById(actor, essay.id);
    expect(readAsConvertedUser?.id).toBe(essay.id);
    expect(readAsStaleGuestSession).toBeNull();
  });

  it('refuses to write an essay under a session id that was never created', async () => {
    const actor = newGuestActor(); // never persisted via createGuestSession

    await expect(
      createEssay(actor, 'An essay under a session id that does not exist.'),
    ).rejects.toThrow(/guest session no longer exists/);
  });

  it('KAN-24/KAN-36: the thrown message never embeds the session id — it is a live bearer credential', async () => {
    const actor = newGuestActor(); // never persisted via createGuestSession

    try {
      await createEssay(actor, 'An essay under a session id that does not exist.');
      expect.unreachable('createEssay should have thrown for a session id with no row');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(actor.sessionId);
    }
  });

  it('does not leave an essay unattached when the write races a concurrent conversion', async () => {
    // No sleeps, no forced interleaving — this asserts the invariant that
    // must hold under either ordering the row lock allows, so it is not
    // sensitive to which of the two transactions actually wins the race.
    const actor = newGuestActor();
    await createGuestSession(actor);
    const user = await newUserActor();

    const [essay] = await Promise.all([
      createEssay(actor, 'Written concurrently with a conversion racing it.'),
      convertGuestSessionToUser(actor, user.userId),
    ]);

    const readAsUser = await getEssayById(user, essay.id);
    const readAsStaleGuestSession = await getEssayById(actor, essay.id);
    expect(readAsUser?.id).toBe(essay.id);
    expect(readAsStaleGuestSession).toBeNull();
    // Whichever way the lock let the two interleave, exactly one owner column.
    const row = await rawEssayRow(essay.id);
    expect(row.userId).toBe(user.userId);
    expect(row.sessionId).toBeNull();
  });

  it('blocks a concurrent write behind the session row lock, rather than merely racing it', async () => {
    // The race test above ("does not leave an essay unattached...") proves
    // the *outcome* holds under either interleaving the lock allows, but the
    // window it races is sub-millisecond against a local database, so it
    // cannot actually land inside the gap `.for('update')` closes — deleting
    // that clause (and the transaction around it) still leaves it green.
    // This test instead observes the lock directly: a second connection
    // holds the exact row lock `convertGuestSessionToUser`'s UPDATE takes,
    // and we assert `createEssay` is still pending while that lock is held.
    const actor = newGuestActor();
    await createGuestSession(actor);

    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let settled = false;
    try {
      await blocker.query('BEGIN');
      // FOR NO KEY UPDATE, not FOR UPDATE: that's the lock strength a plain
      // UPDATE (convertGuestSessionToUser's real adversary) takes. FOR
      // UPDATE would also be blocked by the insert's own FK check against
      // the parent row, so the test would pass whether or not `createEssay`
      // takes its own lock — proving nothing about the code under test.
      await blocker.query(
        'SELECT 1 FROM fluentina.guest_sessions WHERE id = $1 FOR NO KEY UPDATE',
        [actor.sessionId],
      );

      const pending = createEssay(actor, 'Written while the session row is locked by another connection.').then(
        (e) => {
          settled = true;
          return e;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false); // still waiting on the row lock

      await blocker.query('COMMIT');
      const essay = await pending;
      expect(essay.sessionId).toBe(actor.sessionId);
    } finally {
      // If the assertion above throws, the transaction is still open and
      // still holding the lock — without this, the next test's
      // `resetDatabase` TRUNCATE hangs behind it for ~10s.
      await blocker.query('COMMIT').catch(() => {});
      await blocker.end();
    }
  });
});

describe('createEssay — a registered user (KAN-52)', () => {
  it('owns the essay by account: user_id set, session_id NULL, readable by that user', async () => {
    const user = await newUserActor();

    const essay = await createEssay(user, 'An essay submitted straight from a registered account.');

    expect(essay.userId).toBe(user.userId);
    expect(essay.sessionId).toBeNull();
    const row = await rawEssayRow(essay.id);
    expect(row.userId).toBe(user.userId);
    expect(row.sessionId).toBeNull();
    expect((await getEssayById(user, essay.id))?.content).toBe('An essay submitted straight from a registered account.');
  });

  it('needs no guest session at all — the row a registered user does not have is not required', async () => {
    const user = await newUserActor();

    await createEssay(user, 'No guest_sessions row exists anywhere in this database.');

    expect(await db.select().from(guestSessions)).toHaveLength(0);
  });

  // The account IS the owner: there is no session row whose conversion state
  // could race this write, so there is nothing to lock and no reason to open a
  // transaction (which would hold a pooled connection and, were it to lock the
  // users row, contend with the essays->users foreign key's own row lock). A
  // spy, not a lock probe: a guest write opens exactly one transaction, so this
  // fails if the user branch ever starts taking the guest branch's shape.
  it('opens no transaction and takes no lock: a single insert, unlike the guest branch', async () => {
    const user = await newUserActor();
    const spy = vi.spyOn(db, 'transaction');

    try {
      await createEssay(user, 'An account-owned write has no session row to serialise against.');
      expect(spy).not.toHaveBeenCalled();

      const guest = newGuestActor();
      await createGuestSession(guest);
      await createEssay(guest, 'Control: a guest write does open a transaction.');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('is invisible to a guest — including one whose own session has essays — and to another user', async () => {
    // A stranger guest WITH a session and an essay of its own, so the read
    // below is a query that could match something, not one over an empty table.
    const owner = await newUserActor();
    const strangerUser = await newUserActor();
    const strangerGuest = newGuestActor();
    await createGuestSession(strangerGuest);
    await createEssay(strangerGuest, 'The stranger guest has an essay of their own, so their reads are not trivially empty.');
    const essay = await createEssay(owner, 'An account-owned essay that only its owner may read.');

    expect(await getEssayById(strangerGuest, essay.id)).toBeNull();
    expect(await getEssayById(strangerUser, essay.id)).toBeNull();
    expect((await getEssayById(owner, essay.id))?.id).toBe(essay.id);
  });

  it('refuses a user id that names no account — the foreign key, not a silent orphan', async () => {
    await expect(createEssay({ kind: 'user', userId: randomUUID() }, 'An essay for an account that does not exist.')).rejects.toThrow();
  });
});

describe('getEssayById', () => {
  it('returns null for an id that does not exist at all', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);

    const result = await getEssayById(actor, randomUUID());

    expect(result).toBeNull();
  });

  it('returns the same null for "not found" and "found but not owned" — a caller cannot tell them apart', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, 'Owned by one guest session only.');

    const notFound = await getEssayById(stranger, randomUUID());
    const notOwned = await getEssayById(stranger, essay.id);

    expect(notFound).toBeNull();
    expect(notOwned).toBeNull();
  });
});

describe('getEssayByIdUnscoped', () => {
  it('a system actor can read an essay regardless of which guest or user owns it', async () => {
    // "Regardless of owner" has to be demonstrated against an essay that
    // actually has one — converting first is what proves this reads past
    // ownership rather than merely reading an unattached row, which any
    // unscoped-looking query would also do by accident. A grading worker
    // reading nothing for every essay belonging to a registered user is
    // exactly the regression this guards against.
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay a grading worker needs to read without an end-user actor.');
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);
    const systemActor: SystemActor = { kind: 'system', job: 'grading-worker' };

    const result = await getEssayByIdUnscoped(systemActor, essay.id);

    expect(result?.id).toBe(essay.id);
    expect(result?.userId).toBe(user.userId);
  });
});
