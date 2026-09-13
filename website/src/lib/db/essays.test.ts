/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEssay, getEssayById, getEssayByIdUnscoped } from './essays';
import { createGuestSession, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, closePool } from './test-helpers';
import type { GuestActor, SystemActor } from '@/lib/contracts/actor';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
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
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay a grading worker needs to read without an end-user actor.');
    const systemActor: SystemActor = { kind: 'system', job: 'grading-worker' };

    const result = await getEssayByIdUnscoped(systemActor, essay.id);

    expect(result?.id).toBe(essay.id);
  });
});
