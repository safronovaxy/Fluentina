/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { logGradingJobTelemetry } from './telemetry';
import { generateGuestSessionId } from '@/lib/domain/session-id';

/**
 * KAN-16 round-1 review, finding 6: there was no test file for `telemetry.ts`
 * at all, and nothing anywhere referenced `grading_job_completed` or
 * `logGradingJobTelemetry` outside the production modules — mutation-proved
 * by the reviewer: deleting the telemetry call from every failure path, and
 * separately from the success path, both left 454/454 green. This file pins
 * the exact emitted shape directly, independent of `orchestrate-grading.ts`
 * ever calling it correctly (that wiring is what `orchestrate-grading.test.ts`
 * asserts).
 */
describe('logGradingJobTelemetry — KAN-24: the one line every grading job produces, pinned exactly', () => {
  it('logs a success event with exactly the documented field set, at INFO severity', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sessionId = generateGuestSessionId();

    logGradingJobTelemetry({
      submissionId: 'essay-1',
      sessionId,
      provider: 'fake',
      latencyMs: 1234,
      success: true,
      errorType: null,
      spanValidationPassed: true,
      promptInjectionSuspected: false,
      tokenCountEstimate: 500,
      costEstimateUsd: 0.01,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);

    // The exact field set — see docs/kan-24-grading-telemetry.md's own field
    // table. A field silently added, removed, or renamed (e.g. `latencyMs`
    // -> `latency_ms`) goes red here instead of leaving that doc's saved
    // queries silently returning nothing.
    expect(Object.keys(line).sort()).toEqual(
      [
        'costEstimateUsd',
        'errorType',
        'event',
        'latencyMs',
        'promptInjectionSuspected',
        'provider',
        'sessionIdHash',
        'severity',
        'spanValidationPassed',
        'submissionId',
        'success',
        'timestamp',
        'tokenCountEstimate',
      ].sort(),
    );
    expect(line).toMatchObject({
      event: 'grading_job_completed',
      severity: 'INFO',
      submissionId: 'essay-1',
      provider: 'fake',
      latencyMs: 1234,
      success: true,
      errorType: null,
      spanValidationPassed: true,
      promptInjectionSuspected: false,
      tokenCountEstimate: 500,
      costEstimateUsd: 0.01,
    });

    // KAN-16 round-1 review, finding 7 — the mutation that matters most:
    // `sessionIdHash: hashSessionId(event.sessionId)` -> `sessionIdHash:
    // event.sessionId` (a live bearer credential, in a Cloud Logging line)
    // left 454/454 green. Asserted directly, not just "hash !== raw", so a
    // mutant that smuggles the raw id under some OTHER field is also caught.
    expect(line.sessionIdHash).not.toBe(sessionId);
    expect(JSON.stringify(line)).not.toContain(sessionId);
    logSpy.mockRestore();
  });

  it('logs a failure event at WARNING severity, with the same exact field set, and null provider/spanValidationPassed/sessionIdHash when none is available', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logGradingJobTelemetry({
      submissionId: 'essay-2',
      sessionId: null,
      provider: null,
      latencyMs: 42,
      success: false,
      errorType: 'wordCountOutOfBounds',
      spanValidationPassed: null,
      promptInjectionSuspected: false,
      tokenCountEstimate: 0,
      costEstimateUsd: 0,
    });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(Object.keys(line).sort()).toEqual(
      [
        'costEstimateUsd',
        'errorType',
        'event',
        'latencyMs',
        'promptInjectionSuspected',
        'provider',
        'sessionIdHash',
        'severity',
        'spanValidationPassed',
        'submissionId',
        'success',
        'timestamp',
        'tokenCountEstimate',
      ].sort(),
    );
    expect(line).toMatchObject({
      event: 'grading_job_completed',
      severity: 'WARNING',
      success: false,
      errorType: 'wordCountOutOfBounds',
      provider: null,
      spanValidationPassed: null,
      sessionIdHash: null,
    });
    logSpy.mockRestore();
  });

  it('logs null, not 0, for a genuinely unknown token/cost estimate (finding 12)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logGradingJobTelemetry({
      submissionId: 'essay-3',
      sessionId: null,
      provider: 'mistral',
      latencyMs: 10,
      success: false,
      errorType: 'invalidProviderResponse',
      spanValidationPassed: null,
      promptInjectionSuspected: false,
      tokenCountEstimate: null,
      costEstimateUsd: null,
    });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.tokenCountEstimate).toBeNull();
    expect(line.costEstimateUsd).toBeNull();
    logSpy.mockRestore();
  });

  it('the same session id always hashes to the same value — a usable correlation key, same construction as essay-submission-telemetry.ts', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sessionId = generateGuestSessionId();
    const event = {
      submissionId: 'a',
      sessionId,
      provider: 'fake' as const,
      latencyMs: 1,
      success: true,
      errorType: null,
      spanValidationPassed: true,
      promptInjectionSuspected: false,
      tokenCountEstimate: 1,
      costEstimateUsd: 0,
    };

    logGradingJobTelemetry(event);
    logGradingJobTelemetry({ ...event, submissionId: 'b' });

    const [first, second] = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(first.sessionIdHash).toBe(second.sessionIdHash);
    logSpy.mockRestore();
  });
});
