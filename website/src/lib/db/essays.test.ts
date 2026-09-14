/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
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
    const readAsConvertedUser = await getEssayById(user, essay.id);
    const readAsStaleGuestSession = await getEssayById(actor, essay.id);
    expect(readAsConvertedUser?.id).toBe(essay.id);
    expect(readAsStaleGuestSession).toBeNull();
  });

  it('refuses to write an essay under a session id that was never created', async () => {
    const actor = newGuestActor(); // never persisted via createGuestSession

    await expect(
      createEssay(actor, 'An essay under a session id that does not exist.'),
    ).rejects.toThrow(/no guest session found/);
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
