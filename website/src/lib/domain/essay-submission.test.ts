/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { submitEssay } from './essay-submission';
import { generateGuestSessionId } from './session-id';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { getEssayById } from '@/lib/db/essays';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import type { GuestActor } from '@/lib/contracts/actor';

// Round-1 review (blocking): `submitEssay` used to take the raw, possibly
// absent cookie value and resolve it itself (via `resolveGuestSession`),
// so this file used to duplicate a large slice of `guest-session.test.ts`'s
// own resolution coverage (missing cookie, malformed cookie, the
// already-converted-session reissue trap) purely to prove the insert
// happened under the right id. Resolution is now the CALLER's job — see
// `essay-submission.ts`'s own comment — so `submitEssay` has exactly one
// job left: insert `content` under whatever `Actor` it's given, verbatim.
// `resolveGuestSession`'s own resolution behaviour stays covered where it
// actually lives, in `guest-session.test.ts`; this file only needs to prove
// this function does not re-derive or second-guess the actor it's handed.
beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('submitEssay', () => {
  it('persists content under exactly the actor it is given, and it is readable back through that same actor', async () => {
    const sessionId = generateGuestSessionId();
    const actor: GuestActor = { kind: 'guest', sessionId };
    await createGuestSession(actor);

    const essay = await submitEssay(actor, 'An essay persisted under a pre-resolved actor.');

    expect(essay.sessionId).toBe(sessionId);
    expect(essay.userId).toBeNull();
    expect(essay.content).toBe('An essay persisted under a pre-resolved actor.');

    const readBack = await getEssayById(actor, essay.id);
    expect(readBack?.id).toBe(essay.id);
  });

  it('does not resolve or otherwise reinterpret the actor it is given — passing an id whose row was never created fails on the FK, rather than silently minting or creating one', async () => {
    // If this function ever regained a resolution step of its own (the
    // exact thing round-1 review removed — see this file's own top
    // comment), a never-persisted id like this one would silently succeed,
    // with a row created for it. `createEssay`'s own contract (lib/db/
    // essays.ts) is to reject a session id with no backing row instead —
    // this pins that submitEssay does not paper over that with resolution
    // logic of its own.
    const neverPersistedActor: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };

    await expect(submitEssay(neverPersistedActor, 'Should never be persisted.')).rejects.toThrow();
  });
});
