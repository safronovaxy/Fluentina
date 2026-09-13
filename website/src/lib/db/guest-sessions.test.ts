/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEssay, getEssayById } from './essays';
import { createGuestSession, getGuestSessionById, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from './test-helpers';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

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

describe('createGuestSession', () => {
  it('persists a session keyed by the generated bearer id, unattached to any user', async () => {
    const actor = newGuestActor();

    const session = await createGuestSession(actor);

    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(session.convertedAt).toBeNull();
  });
});

describe('getGuestSessionById', () => {
  it('a guest can read its own session; another guest cannot', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);

    const own = await getGuestSessionById(owner, owner.sessionId);
    const others = await getGuestSessionById(stranger, owner.sessionId);

    expect(own?.id).toBe(owner.sessionId);
    expect(others).toBeNull();
  });
});

describe('convertGuestSessionToUser', () => {
  it('attaches the session and every essay under it to the user in one operation', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essayOne = await createEssay(actor, 'First essay written before conversion.');
    const essayTwo = await createEssay(actor, 'Second essay, also written before conversion.');
    const user = await newUserActor();

    await convertGuestSessionToUser(actor, user.userId);

    const convertedSession = await getGuestSessionById(user, actor.sessionId);
    const convertedEssayOne = await getEssayById(user, essayOne.id);
    const convertedEssayTwo = await getEssayById(user, essayTwo.id);

    expect(convertedSession?.userId).toBe(user.userId);
    expect(convertedSession?.convertedAt).not.toBeNull();
    expect(convertedEssayOne?.userId).toBe(user.userId);
    expect(convertedEssayTwo?.userId).toBe(user.userId);
  });

  it('rejects converting a session id that was never created', async () => {
    const actor = newGuestActor(); // never persisted via createGuestSession
    // No row matches the WHERE clause, so the update touches nothing and the
    // FK is never checked — a made-up id is fine here, unlike the tests
    // above where the update actually has to write this value.
    const madeUpUserId = randomUUID();

    await expect(convertGuestSessionToUser(actor, madeUpUserId)).rejects.toThrow(
      /no unconverted session found/,
    );
  });
});
