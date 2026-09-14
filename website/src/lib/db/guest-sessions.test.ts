/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEssay, getEssayById } from './essays';
import { createGuestSession, getGuestSessionById, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
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

  it('does not touch a second, unrelated guest session or its essay', async () => {
    // The essays update is the one multi-row write in this story. Every
    // other conversion test above has exactly one guest session in the
    // database when it runs, so a predicate that dropped the session match
    // — leaving only "unattached" — would attach every OTHER guest's
    // unattached essay to the converting user too, and every test would
    // still pass. This is the case that catches that: a bystander session,
    // never converted, with its own essay.
    const converting = newGuestActor();
    const bystander = newGuestActor();
    await createGuestSession(converting);
    await createGuestSession(bystander);
    await createEssay(converting, 'Essay under the session that will be converted.');
    const bystanderEssay = await createEssay(bystander, 'Essay under an entirely unrelated guest session.');
    const user = await newUserActor();

    await convertGuestSessionToUser(converting, user.userId);

    const bystanderSessionAfter = await getGuestSessionById(bystander, bystander.sessionId);
    const bystanderEssayAsItsOwnGuest = await getEssayById(bystander, bystanderEssay.id);
    const bystanderEssayAsConvertingUser = await getEssayById(user, bystanderEssay.id);

    // Still a guest session, not swept up into the conversion.
    expect(bystanderSessionAfter?.userId).toBeNull();
    expect(bystanderSessionAfter?.convertedAt).toBeNull();
    // Its own guest can still read its essay...
    expect(bystanderEssayAsItsOwnGuest?.id).toBe(bystanderEssay.id);
    // ...and the converting user, despite now owning everything under its
    // own session, must not be able to read someone else's.
    expect(bystanderEssayAsConvertingUser).toBeNull();
  });
});
