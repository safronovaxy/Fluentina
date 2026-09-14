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
    const { actor, session, isNew, reissued } = await resolveGuestSession(undefined);

    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(isNew).toBe(true);
    // There was nothing to reuse — the caller must set a cookie.
    expect(reissued).toBe(true);

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

    const { actor, session, isNew, reissued } = await resolveGuestSession(mintedByEdge);

    expect(actor.sessionId).toBe(mintedByEdge);
    expect(session.id).toBe(mintedByEdge);
    expect(isNew).toBe(true);
    // The id presented is the id resolved under — nothing for the caller to
    // reissue a cookie for.
    expect(reissued).toBe(false);
  });
});

describe('resolveGuestSession — well-formed cookie, row already exists (returning guest)', () => {
  it('reuses the existing session rather than creating another', async () => {
    const first = await resolveGuestSession(undefined);

    const second = await resolveGuestSession(first.actor.sessionId);

    expect(second.actor.sessionId).toBe(first.actor.sessionId);
    expect(second.session.createdAt).toEqual(first.session.createdAt);
    expect(second.isNew).toBe(false);
    expect(second.reissued).toBe(false);
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

    const { actor, session, isNew, reissued } = await resolveGuestSession(forged);

    expect(actor.sessionId).not.toBe(forged);
    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).not.toBe(forged);
    expect(isNew).toBe(true);
    // The id resolved under is not the one presented — the caller must
    // overwrite whatever cookie was there.
    expect(reissued).toBe(true);

    // The forged string itself must never have reached the database as a
    // primary key — not even a row that later got superseded.
    const forgedActor = { kind: 'guest' as const, sessionId: forged as GuestSessionId };
    expect(await getGuestSessionById(forgedActor, forged)).toBeNull();
  });

  it('rejects a well-formed-length but uppercase value the same way — the format is lowercase hex only', async () => {
    const uppercase = generateGuestSessionId().toUpperCase();

    const { actor, isNew, reissued } = await resolveGuestSession(uppercase);

    expect(actor.sessionId).not.toBe(uppercase);
    expect(isNew).toBe(true);
    expect(reissued).toBe(true);
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
    const { actor, session, isNew, reissued } = await resolveGuestSession(originalActor.sessionId);

    expect(actor.sessionId).not.toBe(originalActor.sessionId);
    expect(guestSessionIdSchema.safeParse(actor.sessionId).success).toBe(true);
    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(isNew).toBe(true);
    // The id resolved under differs from the one presented — the caller
    // must reissue the cookie, or (KAN-14) write under this id rather than
    // the one the browser's current cookie names.
    expect(reissued).toBe(true);

    // The old, converted session is untouched — still attached to the user,
    // not somehow reopened as a guest session by this call.
    const convertedSession = await getGuestSessionById(
      { kind: 'user', userId },
      originalActor.sessionId,
    );
    expect(convertedSession?.userId).toBe(userId);
  });
});

describe('resolveGuestSession — a genuine, unexpected failure creating the row', () => {
  // Review (round 2): both `if (!(err instanceof SessionIdUnavailableError))
  // throw err;` (the outer catch in resolveGuestSession) and `if
  // (!isUniqueViolation(err)) throw err;` (createSessionTolerably's own
  // catch) survived the entire suite as mutants before this test existed —
  // every test above proves "on an error, mint a fresh id", none of them
  // proves "on THIS error, and only this one". With either guard deleted, a
  // statement timeout or a serialisation failure gets treated exactly like
  // a unique-violation-on-a-converted-session: silently swallowed, and the
  // guest gets rotated onto a different session id with a 200, severing
  // their in-flight work with nothing anywhere to show it happened.
  it('rejects rather than minting a fresh session, when session creation fails for a reason that has nothing to do with a unique-key conflict', async () => {
    const freshId = generateGuestSessionId();
    // SQLSTATE 57014 (query_canceled — e.g. a statement timeout), not 23505
    // (unique_violation): a real, different failure mode, shaped the way
    // isUniqueViolation actually reads a driver error (see that function's
    // own comment on `.code` vs `.cause.code`).
    const timeoutError = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    const createSpy = vi.spyOn(guestSessionsDb, 'createGuestSession').mockRejectedValueOnce(timeoutError);

    try {
      await expect(resolveGuestSession(freshId)).rejects.toBe(timeoutError);
    } finally {
      createSpy.mockRestore();
    }

    // Not silently recovered from by minting a different id under the
    // covers, either — nothing was ever created for this id at all.
    expect(await getGuestSessionById({ kind: 'guest', sessionId: freshId }, freshId)).toBeNull();
  });
});
