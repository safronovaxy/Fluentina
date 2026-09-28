/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as essayRead from '@/lib/domain/essay-read';
import { randomUUID } from 'node:crypto';
import { isValidElement, type ReactNode } from 'react';
import { createEssay } from '@/lib/db/essays';
import { createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { GradingPreview } from '@/components/guest/GradingPreview';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import type { GuestActor } from '@/lib/contracts/actor';

/**
 * The preview page is where essay TEXT is read for a guest, so it is where
 * the row-level ownership rule for that read is enforced — the grading poll
 * enforces it for the result, this enforces it for the essay the result's
 * offsets point into. Real database, real `getOwnedEssay`; only the Next
 * request context (cookies, notFound) and the translator are stubbed.
 */
let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === GUEST_SESSION_COOKIE_NAME && cookieValue ? { name, value: cookieValue } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  // Next's real notFound() throws to abort rendering; the page relies on that.
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
}));

import GuestPreviewPage from './page';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

function render(essay?: string | string[]) {
  return GuestPreviewPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ essay }) });
}

/** Depth-first search of a React element tree for the first element of `type`. */
function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node as unknown as { props: Record<string, unknown> };
  return findElement(node.props.children, type);
}

beforeAll(async () => {
  await resetDatabase();
});
afterEach(async () => {
  vi.restoreAllMocks();
  cookieValue = undefined;
  await resetDatabase();
});
afterAll(async () => {
  await closePool();
});

describe('guest preview page — ownership of the essay it renders (KAN-18)', () => {
  it("passes the owner's stored essay text, verbatim, to the preview", async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, ' Mein Aufsatz.\r\nZweite Zeile. ');
    cookieValue = actor.sessionId;

    const preview = findElement(await render(essay.id), GradingPreview);

    expect(preview?.props.essayId).toBe(essay.id);
    expect(preview?.props.essayContent).toBe(' Mein Aufsatz.\r\nZweite Zeile. ');
  });

  it("404s for another guest's essay, and never reads it", async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, 'Nur für die Besitzerin.');
    cookieValue = stranger.sessionId;

    await expect(render(essay.id)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s with no guest cookie at all', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Ein Aufsatz ohne Cookie.');
    cookieValue = undefined;
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    await expect(render(essay.id)).rejects.toThrow('NEXT_NOT_FOUND');
    // Turned away before any read is attempted, not merely by finding nothing.
    expect(read).not.toHaveBeenCalled();
  });

  it('404s with a malformed guest cookie', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Ein Aufsatz mit kaputtem Cookie.');
    cookieValue = 'not-a-session-id';
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    await expect(render(essay.id)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(read).not.toHaveBeenCalled();
  });

  it('404s for an essay id that does not exist, and for one that is not even a UUID (which would otherwise reach Postgres as a type error)', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    cookieValue = actor.sessionId;

    await expect(render(randomUUID())).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render("1' OR '1'='1")).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s when the essay parameter is missing or repeated', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Ein Aufsatz.');
    cookieValue = actor.sessionId;
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    await expect(render(undefined)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render([essay.id, essay.id])).rejects.toThrow('NEXT_NOT_FOUND');
    expect(read).not.toHaveBeenCalled();
  });

  it('once the guest has converted to an account, the old guest session id stops opening the preview', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Geschrieben als Gast.');
    await convertGuestSessionToUser(actor, await createTestUser());
    cookieValue = actor.sessionId;

    await expect(render(essay.id)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
