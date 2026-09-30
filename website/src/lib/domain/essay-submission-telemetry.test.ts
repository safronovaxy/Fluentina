/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { logEssaySubmission } from './essay-submission-telemetry';
import { generateGuestSessionId } from './session-id';
import type { GuestActor, UserActor } from '@/lib/contracts/actor';

const guestActor = (): GuestActor => ({ kind: 'guest', sessionId: generateGuestSessionId() });
const userActor = (): UserActor => ({ kind: 'user', userId: randomUUID() });

function capture(): { lines: () => Record<string, unknown>[]; restore: () => void } {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return {
    lines: () => logSpy.mock.calls.map((call) => JSON.parse(call[0] as string)),
    restore: () => logSpy.mockRestore(),
  };
}

describe('logEssaySubmission — KAN-24 carried-over note: the submission endpoint must emit SOMETHING', () => {
  it('a guest line carries a hashed session id, the content length, and the outcome — never the session id itself', () => {
    const log = capture();
    const actor = guestActor();

    logEssaySubmission(actor, 234, 'created');

    expect(log.lines()).toHaveLength(1);
    const line = log.lines()[0];
    expect(line.event).toBe('essay_submission');
    expect(line.contentLength).toBe(234);
    expect(line.outcome).toBe('created');
    expect(line.sessionIdHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(line)).not.toContain(actor.sessionId);
    log.restore();
  });

  it('the same session id always hashes to the same value — a usable correlation key across log lines', () => {
    const log = capture();
    const actor = guestActor();

    logEssaySubmission(actor, 100, 'created');
    logEssaySubmission(actor, 200, 'error');

    const [first, second] = log.lines();
    expect(first.sessionIdHash).toBe(second.sessionIdHash);
    log.restore();
  });

  it('an error outcome logs at ERROR severity, a created outcome at INFO', () => {
    const log = capture();
    const actor = guestActor();

    logEssaySubmission(actor, 10, 'error');
    logEssaySubmission(actor, 10, 'created');

    expect(log.lines()[0].severity).toBe('ERROR');
    expect(log.lines()[1].severity).toBe('INFO');
    log.restore();
  });
});

describe('logEssaySubmission — KAN-52: a registered submission is correlatable too', () => {
  it('a registered line carries a hashed user id, in its own field — never the user id itself, never an email', () => {
    const log = capture();
    const actor = userActor();

    logEssaySubmission(actor, 321, 'created');

    const line = log.lines()[0];
    expect(line.event).toBe('essay_submission');
    expect(line.contentLength).toBe(321);
    expect(line.outcome).toBe('created');
    expect(line.userIdHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(line)).not.toContain(actor.userId);
    // The two identity fields are exclusive, so a query on either selects one kind of submitter.
    expect(line).not.toHaveProperty('sessionIdHash');
    log.restore();
  });

  it('a guest line has no userIdHash — the exclusivity holds in both directions', () => {
    const log = capture();

    logEssaySubmission(guestActor(), 1, 'created');

    expect(log.lines()[0]).not.toHaveProperty('userIdHash');
    log.restore();
  });

  it('the same user id always hashes to the same value, and different users to different ones', () => {
    const log = capture();
    const actor = userActor();

    logEssaySubmission(actor, 1, 'created');
    logEssaySubmission(actor, 2, 'error');
    logEssaySubmission(userActor(), 3, 'created');

    const [first, second, third] = log.lines();
    expect(first.userIdHash).toBe(second.userIdHash);
    expect(first.userIdHash).not.toBe(third.userIdHash);
    log.restore();
  });

  it('a registered error outcome still emits a correlatable line at ERROR severity — not silence', () => {
    const log = capture();

    logEssaySubmission(userActor(), 5, 'error');

    expect(log.lines()).toHaveLength(1);
    expect(log.lines()[0]).toMatchObject({ severity: 'ERROR', outcome: 'error' });
    expect(log.lines()[0].userIdHash).toEqual(expect.any(String));
    log.restore();
  });
});
