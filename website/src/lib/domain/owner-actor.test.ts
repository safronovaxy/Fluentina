/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import type { UserActor } from '@/lib/contracts/actor';

// The registered-session lookup is the KAN-20 seam and resolves to null today;
// standing a registered session in front of the resolver is the only way to
// observe the ORDER it applies, which is what these tests are for.
const registered = vi.hoisted(() => ({ current: null as UserActor | null }));
vi.mock('./registered-session', () => ({
  resolveRegisteredSession: vi.fn(async () => registered.current),
}));

import { resolveOwnerActor } from './owner-actor';
import { resolveRegisteredSession } from './registered-session';

const REGISTERED: UserActor = { kind: 'user', userId: '0b1f6f0e-6c1e-4a0e-9d3a-0f6a5f3f7a11' };

function cookies(values: Record<string, string>) {
  return (name: string) => values[name];
}

beforeEach(() => {
  registered.current = null;
  vi.mocked(resolveRegisteredSession).mockClear();
});

describe('resolveOwnerActor — one HTTP-to-actor rule for every adapter (KAN-19)', () => {
  it('builds a guest actor from a well-formed guest cookie', async () => {
    const sessionId = generateGuestSessionId();

    const actor = await resolveOwnerActor(cookies({ [GUEST_SESSION_COOKIE_NAME]: sessionId }));

    expect(actor).toEqual({ kind: 'guest', sessionId });
  });

  it('is null with no cookie at all', async () => {
    expect(await resolveOwnerActor(cookies({}))).toBeNull();
  });

  it.each([
    ['not hex', 'not-a-session-id'],
    ['too short', 'abcdef'],
    ['uppercase', 'A'.repeat(32)],
    ['empty', ''],
  ])('is null for a malformed guest cookie (%s) — never a guest actor built from unvalidated input', async (_name, value) => {
    expect(await resolveOwnerActor(cookies({ [GUEST_SESSION_COOKIE_NAME]: value }))).toBeNull();
  });

  it('reads the guest cookie only under its own name', async () => {
    const readCookie = vi.fn((name: string) => (name === GUEST_SESSION_COOKIE_NAME ? generateGuestSessionId() : undefined));

    await resolveOwnerActor(readCookie);

    expect(readCookie).toHaveBeenCalledWith(GUEST_SESSION_COOKIE_NAME);
  });

  // The reason the order exists. After conversion `ownedBy` for a GuestActor
  // needs `user_id IS NULL`, so a guest actor built from a converted user's
  // stale guest cookie is 404'd on their own essay.
  it('a registered session wins over a guest cookie that is still in the browser — registered first, guest only as fallback', async () => {
    registered.current = REGISTERED;
    const staleGuestCookie = generateGuestSessionId();

    const actor = await resolveOwnerActor(cookies({ [GUEST_SESSION_COOKIE_NAME]: staleGuestCookie }));

    expect(actor).toEqual(REGISTERED);
  });

  it('a registered session with no guest cookie at all is still that user', async () => {
    registered.current = REGISTERED;

    expect(await resolveOwnerActor(cookies({}))).toEqual(REGISTERED);
  });

  it('with no registered session, the guest cookie is the fallback', async () => {
    const sessionId = generateGuestSessionId();

    const actor = await resolveOwnerActor(cookies({ [GUEST_SESSION_COOKIE_NAME]: sessionId }));

    expect(actor?.kind).toBe('guest');
    expect(resolveRegisteredSession).toHaveBeenCalledTimes(1);
  });

  it('hands the registered-session lookup the same cookie reader it was given', async () => {
    const readCookie = cookies({});

    await resolveOwnerActor(readCookie);

    expect(resolveRegisteredSession).toHaveBeenCalledWith(readCookie);
  });
});
