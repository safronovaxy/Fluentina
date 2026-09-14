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
import { and } from 'drizzle-orm';
import { db } from './client';
import { essays as essaysTable } from './schema';
import { buildOwnershipCondition } from './ownership';
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
  it('converting an already-converted session throws instead of silently re-attaching', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    await createEssay(actor, 'An essay under a session that will be converted exactly once.');
    const firstUser = await newUserActor();
    const secondUser = await newUserActor();

    await convertGuestSessionToUser(actor, firstUser.userId);

    await expect(convertGuestSessionToUser(actor, secondUser.userId)).rejects.toThrow(
      /no unconverted session found/,
    );
  });
});
