/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as essayRead from '@/lib/domain/essay-read';
import { randomUUID } from 'node:crypto';
import { isValidElement, type ReactNode } from 'react';
import { createEssay } from '@/lib/db/essays';
import { createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { Button } from '@/components/ui/button';
import { GradingPreview } from '@/components/guest/GradingPreview';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { Link } from '@/i18n/navigation';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

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
// KAN-20's registered-session lookup finds nothing today; see the test below
// that stands one in front of the page.
const registeredSession = vi.hoisted(() => ({ current: null as UserActor | null }));
vi.mock('@/lib/domain/registered-session', () => ({
  resolveRegisteredSession: async () => registeredSession.current,
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
beforeEach(() => {
  registeredSession.current = null;
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
  // KAN-19: the worked example's sentence is cut on the server and arrives
  // with the status poll, so the browser is handed no essay text — and no
  // offsets to index one with. The read below is the page's ownership gate.
  it("hands the preview the essay's id and no essay text — the page still reads the essay, as its ownership gate", async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, ' Mein Geheimer Aufsatz.\r\nZweite Zeile. ');
    cookieValue = actor.sessionId;
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    const preview = findElement(await render(essay.id), GradingPreview);

    expect(preview?.props.essayId).toBe(essay.id);
    expect(preview?.props).not.toHaveProperty('essayContent');
    expect(JSON.stringify(preview?.props.strings)).not.toContain('Geheimer');
    expect(read).toHaveBeenCalledTimes(1);
  });

  // KAN-55: the CTA on the locked panel. The link's target is what makes the
  // funnel close — registration has to know which report to return to.
  it("links the locked panel's call to action to registration with the essay's own id", async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Mein Aufsatz.');
    cookieValue = actor.sessionId;

    const preview = findElement(await render(essay.id), GradingPreview);
    const link = findElement(preview?.props.registerAction as ReactNode, Link);

    expect(link?.props.href).toEqual({ pathname: '/register', query: { essay: essay.id } });
    expect(link?.props.children).toBe('registerCta');
  });

  // The German label is long enough to run off a phone's edge in the stock
  // fixed-height no-wrap Button. jsdom cannot see that, so this pins the choice
  // of size and tests/registration.spec.ts pins the outcome in a real browser.
  it('renders the call to action as a wrapping Button (size="cta"), because its German label is long', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Mein Aufsatz.');
    cookieValue = actor.sessionId;

    const preview = findElement(await render(essay.id), GradingPreview);

    expect(findElement(preview?.props.registerAction as ReactNode, Button)?.props.size).toBe('cta');
  });

  it('highlights the "preview" step in the guest flow indicator — not "write", which it would silently be if this were copy-pasted from the entry page', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Mein Aufsatz.');
    cookieValue = actor.sessionId;

    const shell = findElement(await render(essay.id), GuestFlowShell);

    expect(shell?.props.currentStepId).toBe('preview');
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

// KAN-19: the page resolves its actor through the same `resolveOwnerActor`
// as the poll's route, registered session first. Before that, a converted
// user's stale guest cookie built a GuestActor here and 404'd the owner on
// their own essay the moment registration shipped.
describe('guest preview page — a registered owner (KAN-19)', () => {
  it('opens the owner\'s essay on a registered session even though the old guest cookie is still in the browser', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Geschrieben als Gast.');
    const userId = await createTestUser();
    await convertGuestSessionToUser(actor, userId);
    registeredSession.current = { kind: 'user', userId };
    cookieValue = actor.sessionId; // stale

    const preview = findElement(await render(essay.id), GradingPreview);

    expect(preview?.props.essayId).toBe(essay.id);
  });

  it('a registered user still 404s on an essay that is not theirs', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Nicht deiner.');
    registeredSession.current = { kind: 'user', userId: await createTestUser() };

    await expect(render(essay.id)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
