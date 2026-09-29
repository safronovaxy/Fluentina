/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getOwnedEssay } from './essay-read';
import { createEssay } from '@/lib/db/essays';
import { createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from './session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

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

// The preview screen renders the essay text the grading annotations index
// into, so this read is essay-content access — the ownership rule applies
// to it exactly as it does to the grading poll.
describe('getOwnedEssay (KAN-18: the preview page reads the essay text server-side)', () => {
  it('returns the essay, content verbatim, to the guest session that wrote it', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, '  Ich bin gestern nach Hause gegangen.\r\nDann schlief ich.  ');

    const read = await getOwnedEssay(actor, essay.id);

    // Verbatim, untrimmed: annotation offsets index into exactly this string.
    expect(read?.content).toBe('  Ich bin gestern nach Hause gegangen.\r\nDann schlief ich.  ');
  });

  it("returns null for another guest's essay — indistinguishable from a missing one", async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, 'Ein Text, den nur die Besitzerin lesen darf.');

    expect(await getOwnedEssay(stranger, essay.id)).toBeNull();
    expect(await getOwnedEssay(owner, randomUUID())).toBeNull();
  });

  it('stops authorising the old guest session once it has converted to an account, and the account can read it', async () => {
    const guest = newGuestActor();
    await createGuestSession(guest);
    const essay = await createEssay(guest, 'Geschrieben als Gast, gelesen als Konto.');
    const user: UserActor = { kind: 'user', userId: await createTestUser() };
    await convertGuestSessionToUser(guest, user.userId);

    expect(await getOwnedEssay(guest, essay.id)).toBeNull();
    expect((await getOwnedEssay(user, essay.id))?.id).toBe(essay.id);
  });
});
