/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { logGuestSessionRejection } from './guest-session-rejection-log';

describe('logGuestSessionRejection — KAN-24 carried-over note: a rejection branch that nothing counts is indistinguishable from one that never fires', () => {
  it('logs status and reason only', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logGuestSessionRejection(400, 'invalidSessionCookie');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: 'guest_session_rejected', status: 400, reason: 'invalidSessionCookie' });
    // Never a session id, never a request body — asserted structurally: the
    // logged object has exactly these fields, nothing else that could carry
    // either.
    expect(Object.keys(line).sort()).toEqual(['event', 'reason', 'severity', 'status']);
    logSpy.mockRestore();
  });

  it('logs the cross-origin branch\'s own reason distinctly from the cookie branch\'s', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logGuestSessionRejection(400, 'crossOrigin');

    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.reason).toBe('crossOrigin');
    logSpy.mockRestore();
  });
});
