/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { submitEssay } from './essay-submission';
import { generateGuestSessionId } from './session-id';
import { createGuestSession, convertGuestSessionToUser, getGuestSessionById } from '@/lib/db/guest-sessions';
import { getEssayById } from '@/lib/db/essays';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('submitEssay — well-formed cookie, row already exists (returning guest)', () => {
  it('persists the essay under the presented session, and reports nothing to reissue', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const { essay, reissued } = await submitEssay(sessionId, 'An essay written by a returning guest.');

    expect(essay.sessionId).toBe(sessionId);
    expect(essay.userId).toBeNull();
    expect(essay.content).toBe('An essay written by a returning guest.');
    expect(reissued).toBe(false);

    const readBack = await getEssayById({ kind: 'guest', sessionId }, essay.id);
    expect(readBack?.id).toBe(essay.id);
  });
});

describe('submitEssay — well-formed cookie, no row yet (bootstrap never landed)', () => {
  it('creates the session row under the presented id and persists the essay there — the case GuestSessionBootstrap failing (ad blocker, disabled JS) leaves behind', async () => {
    // Mirrors src/middleware.ts having set this cookie moments earlier, with
    // GuestSessionBootstrap's own POST to /api/guest-session never landing —
    // see that component's own comment: KAN-14's submission path must not
    // assume it ran.
    const mintedByMiddleware = generateGuestSessionId();

    const { essay, reissued } = await submitEssay(mintedByMiddleware, 'Written before the bootstrap request ever completed.');

    expect(essay.sessionId).toBe(mintedByMiddleware);
    expect(reissued).toBe(false);
    const persistedSession = await getGuestSessionById({ kind: 'guest', sessionId: mintedByMiddleware }, mintedByMiddleware);
    expect(persistedSession?.id).toBe(mintedByMiddleware);
  });
});

describe('submitEssay — no cookie at all', () => {
  it('mints a fresh session, persists the essay under it, and reports it must be reissued', async () => {
    const { essay, reissued } = await submitEssay(undefined, 'Written with no cookie presented at all.');

    expect(guestSessionIdSchema.safeParse(essay.sessionId).success).toBe(true);
    expect(reissued).toBe(true);
  });
});

describe('submitEssay — the presented cookie names an already-converted session (the reissue trap)', () => {
  // This is the exact failure the Architect flagged: inserting under the
  // PRESENTED id instead of the RESOLVED one would silently write an essay
  // the guest's own browser can never read back, since its cookie would
  // still name the old, now-converted session. The three assertions below
  // are what closes that off — resolved under a different id, retrievable
  // only under that new id, and never under the stale one.
  it('stores the essay under the newly minted id, not the stale one the browser presented', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const { essay, reissued } = await submitEssay(staleSessionId, 'Written by a guest who already converted, but whose browser still has the old cookie.');

    expect(essay.sessionId).not.toBe(staleSessionId);
    expect(guestSessionIdSchema.safeParse(essay.sessionId).success).toBe(true);
    expect(reissued).toBe(true);
  });

  it('is readable back through the new session id', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const { essay } = await submitEssay(staleSessionId, 'Readable only through the reissued session.');

    const readAsNewSession = await getEssayById({ kind: 'guest', sessionId: essay.sessionId }, essay.id);
    expect(readAsNewSession?.id).toBe(essay.id);
  });

  it('is NOT readable through the stale, presented session id — the leak this closes', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const { essay } = await submitEssay(staleSessionId, 'Must not be readable under the id the browser still presents.');

    const readAsStaleSession = await getEssayById({ kind: 'guest', sessionId: staleSessionId }, essay.id);
    expect(readAsStaleSession).toBeNull();
  });
});
