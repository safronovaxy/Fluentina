/** @vitest-environment node */
// `environmentMatchGlobs` (ADR-14's original suggestion for pinning
// data-layer tests to the Node environment) is deprecated in the installed
// Vitest (3.2) in favour of this per-file docblock directive.

/**
 * KAN-10's security test of record.
 *
 * Every scenario below is run against the real local Postgres started by
 * `docker compose up -d db` — not a mock — because the entire point of this
 * story is that a filter either really executes on the real query engine or
 * it doesn't, and the failure mode we care about (returning every row) is
 * invisible to a mocked query builder that never actually runs SQL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Client } from 'pg';
import { db } from './client';
import { essays as essaysTable } from './schema';
import { buildOwnershipCondition, ownedBy } from './ownership';
import { createEssay, getEssayById } from './essays';
import { createGuestSession, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

// A UserActor's userId is a real users.id — essays.user_id and
// guest_sessions.user_id both FK to it — so fixtures create the row rather
// than making up a UUID, exactly as a real registration flow would have to.
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

describe('the ownership predicate never silently collapses to "no filter"', () => {
  it('throws rather than returning undefined when no conditions are given', () => {
    // This is the exact Drizzle footgun the story exists to prevent: and()
    // given zero truthy conditions returns undefined, and undefined passed
    // to .where() is not an error — it is "no filter". Demonstrated for
    // real against a live query below; this proves the guard that stops it
    // from ever reaching that far.
    expect(() => buildOwnershipCondition([])).toThrow(/collapsed to undefined/);
  });

  it('demonstrates the danger directly: and() with no conditions makes .where() match every row', async () => {
    const sessionA = await createGuestSession(newGuestActor());
    const sessionB = await createGuestSession(newGuestActor());
    const essayA = await createEssay({ kind: 'guest', sessionId: sessionA.id }, 'Essay under session A, fifty-plus words to satisfy a future length check, though this test does not exercise that rule at all.');
    const essayB = await createEssay({ kind: 'guest', sessionId: sessionB.id }, 'Essay under session B, entirely unrelated to session A and owned by a different guest altogether.');

    // and() with no arguments is exactly what a bug in ownedBy() could
    // produce before the throwing guard was added. This is what would have
    // reached .where() with no guard in place.
    const dangerousCondition = and();
    expect(dangerousCondition).toBeUndefined();

    const rows = await db.select().from(essaysTable).where(dangerousCondition);
    // Both of session A's and session B's essays come back through a filter
    // that names neither session — the silent full-table read this story
    // exists to prevent, reproduced deliberately so the guard above can be
    // trusted to be catching a real failure mode and not a theoretical one.
    // Scoped to these two ids rather than asserting the table's total
    // length: this is the only test in the suite coupled to global database
    // state (`resetDatabase` between tests hides that today), and an exact
    // length breaks the moment parallel test execution is ever re-enabled.
    const returnedIds = rows.map((row) => row.id);
    expect(returnedIds).toEqual(expect.arrayContaining([essayA.id, essayB.id]));
  });
});

describe('guest ownership', () => {
  it('a guest can read its own essay', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay written by a guest, read back by that same guest session.');

    const result = await getEssayById(actor, essay.id);

    expect(result?.id).toBe(essay.id);
  });

  it('a guest cannot read another session\'s essay', async () => {
    const owner = newGuestActor();
    const intruder = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(intruder);
    const essay = await createEssay(owner, 'An essay that belongs to a different guest session entirely.');

    const result = await getEssayById(intruder, essay.id);

    expect(result).toBeNull();
  });

  it('a guest cannot read its own essay after the session converts to a registered account', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay written before the guest session converts to a user account.');
    const user = await newUserActor();

    await convertGuestSessionToUser(actor, user.userId);
    const resultAsOldGuestSession = await getEssayById(actor, essay.id);

    // This is the acceptance criterion itself: the old session id is still
    // syntactically well-formed and was never revoked anywhere — it simply
    // stops being able to authorise a read, because the row it used to own
    // is no longer unattached.
    expect(resultAsOldGuestSession).toBeNull();
  });
});

describe('user ownership after conversion', () => {
  it('the converted user can read the essay', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay that will be attached to a user account by conversion.');
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);

    const result = await getEssayById(user, essay.id);

    expect(result?.id).toBe(essay.id);
  });

  it('a second, unrelated user cannot read it', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay owned by one user, that a second, unrelated user must not be able to read.');
    const owningUser = await newUserActor();
    const otherUser = await newUserActor();
    await convertGuestSessionToUser(actor, owningUser.userId);

    const result = await getEssayById(otherUser, essay.id);

    expect(result).toBeNull();
  });
});

describe('conversion cannot be replayed', () => {
  it('converting an already-converted session reports nothingToConvert and re-attaches nothing', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay under a session that will be converted exactly once.');
    const firstUser = await newUserActor();
    const secondUser = await newUserActor();

    await expect(convertGuestSessionToUser(actor, firstUser.userId)).resolves.toBe('converted');

    // KAN-20: this used to throw. "Registered twice in two tabs" is an expected
    // event, not a failure — but it must still be a no-op, never a re-attach.
    await expect(convertGuestSessionToUser(actor, secondUser.userId)).resolves.toBe('nothingToConvert');

    expect((await getEssayById(firstUser, essay.id))?.id).toBe(essay.id);
    expect(await getEssayById(secondUser, essay.id)).toBeNull();
  });
});

describe('KAN-52: an account-owned essay has a NULL session_id, and ownedBy() needed no change for it', () => {
  it('matches no guest — `NULL = <id>` is NULL, and WHERE keeps only TRUE — while the owner still matches', async () => {
    // Several guests, each with a session and an essay of their own, so the
    // guest branch is a query that could match something. The account-owned row
    // is inserted directly (session_id NULL, user_id set): the shape conversion
    // and a registered submission both produce.
    const owner = await newUserActor();
    const guests = [newGuestActor(), newGuestActor(), newGuestActor()];
    for (const guest of guests) {
      await createGuestSession(guest);
      await createEssay(guest, 'A guest essay, so no guest reads over an empty table.');
    }
    const [accountRow] = await db
      .insert(essaysTable)
      .values({ sessionId: null, userId: owner.userId, content: 'Owned by an account, no session at all.' })
      .returning();
    expect(accountRow.sessionId).toBeNull();

    for (const guest of guests) {
      expect(await getEssayById(guest, accountRow.id)).toBeNull();
    }
    expect((await getEssayById(owner, accountRow.id))?.id).toBe(accountRow.id);
  });

  it('a guest-owned row (session_id set, user_id NULL) is matched by its guest and by no user — the mirror case', async () => {
    const guest = newGuestActor();
    await createGuestSession(guest);
    const essay = await createEssay(guest, 'A guest-owned essay: session set, user NULL.');
    const someUser = await newUserActor();

    expect((await getEssayById(guest, essay.id))?.id).toBe(essay.id);
    expect(await getEssayById(someUser, essay.id)).toBeNull();
  });

  it('the `user_id IS NULL` conjunct is independently load-bearing: a row with BOTH columns set is refused to its guest', async () => {
    // The both-set state is forbidden by the CHECK, so it cannot be built
    // through any repository function — and without it, every cutover test
    // above passes by the NULL session_id alone, and would still pass if
    // `isNull(userId)` were deleted from ownedBy(). This builds the state
    // inside a transaction that drops the constraint and is ROLLED BACK (DDL is
    // transactional in Postgres), and runs ownedBy()'s own compiled SQL on that
    // same connection, so the predicate is the one under test, not a copy.
    const guest = newGuestActor();
    await createGuestSession(guest);
    const user = await newUserActor();
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE fluentina.essays DROP CONSTRAINT essays_exactly_one_owner');
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO fluentina.essays (session_id, user_id, content) VALUES ($1, $2, $3) RETURNING id',
        [guest.sessionId, user.userId, 'Both owner columns set, in a transaction that will be rolled back.'],
      );
      const essayId = rows[0].id;

      const readAs = async (actor: GuestActor | UserActor) => {
        const compiled = db
          .select({ id: essaysTable.id })
          .from(essaysTable)
          .where(and(eq(essaysTable.id, essayId), ownedBy(actor, { sessionId: essaysTable.sessionId, userId: essaysTable.userId })))
          .toSQL();
        return (await client.query(compiled.sql, compiled.params as unknown[])).rows;
      };

      // The guest's session_id equality is TRUE for this row; only `user_id IS
      // NULL` refuses it. The owner is served by user_id alone.
      expect(await readAs(guest)).toEqual([]);
      expect(await readAs(user)).toEqual([{ id: essayId }]);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
});
