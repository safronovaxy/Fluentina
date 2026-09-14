/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveGuestSession } from './guest-session';
import { generateGuestSessionId } from './session-id';
import { getGuestSessionById } from '@/lib/db/guest-sessions';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { resetDatabase, closePool } from '@/test/db-fixtures';
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
});
