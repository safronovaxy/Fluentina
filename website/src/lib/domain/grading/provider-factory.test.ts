/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGradingProvider } from './provider-factory';

describe('createGradingProvider — ADR-4 provider selection, amended by KAN-44', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('MOCK_GRADING_PROVIDER=1 selects the fake provider — zero network calls', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', '1');
    const provider = createGradingProvider();
    expect(provider.name).toBe('fake');
  });

  it('MOCK_GRADING_PROVIDER=1 wins over everything else — no provider or credential setting can make a mocked run reach a real API', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', '1');
    vi.stubEnv('GRADING_PROVIDER', 'mistral');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-set-but-must-be-ignored');
    vi.stubEnv('MISTRAL_API_KEY', 'set-but-must-be-ignored');
    expect(createGradingProvider().name).toBe('fake');
  });

  it('with nothing set, selects Claude (the Phase 1 primary) — no import-time throw even with no ANTHROPIC_API_KEY configured', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', undefined);
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    const provider = createGradingProvider();
    expect(provider.name).toBe('claude');
  });

  it('GRADING_PROVIDER=mistral selects Mistral, the deferred second step — no import-time throw even with no MISTRAL_API_KEY configured', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', 'mistral');
    vi.stubEnv('MISTRAL_API_KEY', undefined);
    const provider = createGradingProvider();
    expect(provider.name).toBe('mistral');
  });

  it('any MOCK_GRADING_PROVIDER value other than the literal "1" does not select the fake provider', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', 'true');
    vi.stubEnv('GRADING_PROVIDER', undefined);
    expect(createGradingProvider().name).toBe('claude');
  });

  // The orchestrator calls this factory outside its try/catch, after the job
  // is claimed — a throw would strand the job in `processing`.
  it('an unrecognised GRADING_PROVIDER falls back to Claude rather than throwing', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', 'mistrall');
    expect(createGradingProvider().name).toBe('claude');
  });
});
