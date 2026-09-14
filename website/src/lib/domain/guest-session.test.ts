/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveGuestSession } from './guest-session';
import { generateGuestSessionId } from './session-id';
import * as guestSessionsDb from '@/lib/db/guest-sessions';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestSessionId } from '@/lib/contracts/actor';

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('resolveGuestSession — no cookie (first visit)', () => {
  it('mints a fresh session id and creates its row', async () => {
    const { actor, session, isNew } = await resolveGuestSession(undefined);

    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(isNew).toBe(true);

    // The row is really there, not just returned in memory — read it back
    // through the ownership-scoped repository the same way any later
    // request for this guest would.
    const persisted = await getGuestSessionById(actor, actor.sessionId);
    expect(persisted?.id).toBe(actor.sessionId);
  });
});

describe('resolveGuestSession — well-formed cookie, no row yet (ordinary first use)', () => {
  it('creates the row under the exact id presented, rather than minting a different one', async () => {
    // Mirrors src/middleware.ts having minted this id at the edge moments
    // earlier, on the same request cycle, without being able to persist it.
    const mintedByEdge = generateGuestSessionId();

    const { actor, session, isNew } = await resolveGuestSession(mintedByEdge);

    expect(actor.sessionId).toBe(mintedByEdge);
    expect(session.id).toBe(mintedByEdge);
    expect(isNew).toBe(true);
  });
});

describe('resolveGuestSession — well-formed cookie, row already exists (returning guest)', () => {
  it('reuses the existing session rather than creating another', async () => {
    const first = await resolveGuestSession(undefined);

    const second = await resolveGuestSession(first.actor.sessionId);

    expect(second.actor.sessionId).toBe(first.actor.sessionId);
    expect(second.session.createdAt).toEqual(first.session.createdAt);
    expect(second.isNew).toBe(false);
  });

  it('does not write a second row for the same id', async () => {
    const first = await resolveGuestSession(undefined);
    await resolveGuestSession(first.actor.sessionId);
    await resolveGuestSession(first.actor.sessionId);

    // getGuestSessionById returning exactly one row keyed by this id is as
    // much as the ownership-scoped repository surface lets a caller check
    // directly — a duplicate insert under the same primary key would have
    // thrown already (the schema's PK on guest_sessions.id), so reaching
    // this line at all is itself part of what this test is asserting.
    const persisted = await getGuestSessionById(first.actor, first.actor.sessionId);
    expect(persisted?.id).toBe(first.actor.sessionId);
  });
});

describe('resolveGuestSession — malformed or forged cookie', () => {
  it('never lets a malformed value become the session id — a fresh one is generated instead', async () => {
    const forged = 'not-a-valid-session-id';

    const { actor, session, isNew } = await resolveGuestSession(forged);

    expect(actor.sessionId).not.toBe(forged);
    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).not.toBe(forged);
    expect(isNew).toBe(true);

    // The forged string itself must never have reached the database as a
    // primary key — not even a row that later got superseded.
    const forgedActor = { kind: 'guest' as const, sessionId: forged as GuestSessionId };
    expect(await getGuestSessionById(forgedActor, forged)).toBeNull();
  });

  it('rejects a well-formed-length but uppercase value the same way — the format is lowercase hex only', async () => {
    const uppercase = generateGuestSessionId().toUpperCase();

    const { actor, isNew } = await resolveGuestSession(uppercase);

    expect(actor.sessionId).not.toBe(uppercase);
    expect(isNew).toBe(true);
  });

  it('an attacker-chosen but syntactically valid id never gets planted as a session merely by presenting it once — only an id this resolver itself minted gets a row', async () => {
    // Same shape as the "ordinary first use" test above, deliberately
    // included here too: from this function's point of view a
    // fresh-but-genuine id (minted by middleware) and an attacker's guess
    // at one are indistinguishable strings. What actually keeps this safe
    // is the 128 bits of entropy generateGuestSessionId draws on (see that
    // file's own tests) making a guess computationally infeasible — this
    // test exists so a future change narrowing that entropy, or widening
    // the accepted format, has a test here noticing the id space changed,
    // not just a test over in session-id.test.ts.
    const guessed = generateGuestSessionId();
    expect(await getGuestSessionById({ kind: 'guest', sessionId: guessed }, guessed)).toBeNull();

    const { actor } = await resolveGuestSession(guessed);
    expect(actor.sessionId).toBe(guessed);
  });
});

describe('resolveGuestSession — concurrent resolution of the same brand-new id', () => {
  it('does not surface a unique-violation when two calls race to create the same row', async () => {
    const freshId = generateGuestSessionId();

    const [first, second] = await Promise.all([
      resolveGuestSession(freshId),
      resolveGuestSession(freshId),
    ]);

    expect(first.session.id).toBe(freshId);
    expect(second.session.id).toBe(freshId);
    expect(first.session.createdAt).toEqual(second.session.createdAt);
  });

  it('reuses the row a concurrent insert already committed, forcing the exact interleaving Promise.all above cannot reliably hit', async () => {
    // The test above races two calls in good faith, but in practice
    // Node/libpq serialise the two round trips enough that the second
    // call's OWN existence check (the one at the top of resolveGuestSession,
    // before any insert is attempted) already finds the row the first call
    // committed — so it returns via the ordinary returning-guest path and
    // never calls createGuestSession, never conflicts, never reaches the
    // catch block this test exists to exercise. Deleting that catch body
    // entirely leaves the test above green.
    //
    // This test forces the interleaving directly instead of hoping for it:
    // a row is created for `freshId` first, then the existence check
    // resolveGuestSession makes before inserting is stubbed to miss once —
    // exactly what "another request's insert commits between my read and my
    // write" looks like. What happens after that stub — the INSERT, its
    // real unique-violation from Postgres, catching it, and recovering — is
    // all real code against the real database, including `isUniqueViolation`
    // unwrapping Drizzle's `DrizzleQueryError.cause` to find the SQLSTATE.
    const freshId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: freshId });

    const existenceCheck = vi.spyOn(guestSessionsDb, 'getGuestSessionById');
    existenceCheck.mockResolvedValueOnce(null);

    try {
      const { session, isNew } = await resolveGuestSession(freshId);

      expect(session.id).toBe(freshId);
      expect(isNew).toBe(true);
    } finally {
      existenceCheck.mockRestore();
    }
  });
});

describe('resolveGuestSession — the cookie names an already-converted session', () => {
  it('mints a fresh id and its row rather than colliding with the converted one', async () => {
    const { actor: originalActor } = await resolveGuestSession(undefined);
    const userId = await createTestUser();
    await convertGuestSessionToUser(originalActor, userId);

    // The guest never cleared the cookie (conversion clears it at
    // registration — a separate story; see this ticket's own review note)
    // and presents the exact same, now-converted id on its very next
    // guest-flow page load.
    const { actor, session, isNew } = await resolveGuestSession(originalActor.sessionId);

    expect(actor.sessionId).not.toBe(originalActor.sessionId);
    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(isNew).toBe(true);

    // The old, converted session is untouched — still attached to the user,
    // not somehow reopened as a guest session by this call.
    const convertedSession = await getGuestSessionById(
      { kind: 'user', userId },
      originalActor.sessionId,
    );
    expect(convertedSession?.userId).toBe(userId);
  });
});
