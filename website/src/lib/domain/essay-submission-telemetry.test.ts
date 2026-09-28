/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { logEssaySubmission } from './essay-submission-telemetry';
import { generateGuestSessionId } from './session-id';

describe('logEssaySubmission — KAN-24 carried-over note: the submission endpoint must emit SOMETHING', () => {
  it('logs a structured line carrying a hashed session id, the content length, and the outcome — never the session id itself', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sessionId = generateGuestSessionId();

    logEssaySubmission(sessionId, 234, 'created');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.event).toBe('essay_submission');
    expect(line.contentLength).toBe(234);
    expect(line.outcome).toBe('created');
    expect(line.sessionIdHash).not.toBe(sessionId);
    expect(JSON.stringify(line)).not.toContain(sessionId);
    logSpy.mockRestore();
  });

  it('the same session id always hashes to the same value — a usable correlation key across log lines', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sessionId = generateGuestSessionId();

    logEssaySubmission(sessionId, 100, 'created');
    logEssaySubmission(sessionId, 200, 'error');

    const first = JSON.parse(logSpy.mock.calls[0][0] as string);
    const second = JSON.parse(logSpy.mock.calls[1][0] as string);
    expect(first.sessionIdHash).toBe(second.sessionIdHash);
    logSpy.mockRestore();
  });

  it('an error outcome logs at ERROR severity, a created outcome at INFO', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sessionId = generateGuestSessionId();

    logEssaySubmission(sessionId, 10, 'error');
    logEssaySubmission(sessionId, 10, 'created');

    expect(JSON.parse(logSpy.mock.calls[0][0] as string).severity).toBe('ERROR');
    expect(JSON.parse(logSpy.mock.calls[1][0] as string).severity).toBe('INFO');
    logSpy.mockRestore();
  });
});
