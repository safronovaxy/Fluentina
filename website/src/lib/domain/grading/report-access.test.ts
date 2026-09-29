import { describe, expect, it } from 'vitest';
import { reportAccessFor } from './report-access';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import type { GuestActor, OwnerActor, UserActor } from '@/lib/contracts/actor';

const guest: GuestActor = { kind: 'guest', sessionId: generateGuestSessionId() };
const user: UserActor = { kind: 'user', userId: '0b1f6f0e-6c1e-4a0e-9d3a-0f6a5f3f7a11' };

describe('reportAccessFor — the registration seam (KAN-19, BR-4.2)', () => {
  it('a guest is locked out of the full report', () => {
    expect(reportAccessFor(guest)).toBe('locked');
  });

  it('a registered user gets the full report', () => {
    expect(reportAccessFor(user)).toBe('full');
  });

  it('a guest is never `full`, whatever else the actor object carries', () => {
    // An actor that also has a `userId` (a converted guest whose object was
    // built carelessly) is still decided on `kind` alone.
    const odd = { kind: 'guest', sessionId: guest.sessionId, userId: user.userId } as unknown as OwnerActor;
    expect(reportAccessFor(odd)).toBe('locked');
  });

  it('refuses to guess for a kind it has no rule for, rather than falling through to either answer', () => {
    const system = { kind: 'system', job: 'grading-worker' } as unknown as OwnerActor;
    expect(() => reportAccessFor(system)).toThrow(/no report access rule/);
  });
});
