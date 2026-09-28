/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGradingProvider } from './provider-factory';

describe('createGradingProvider — ADR-4 provider selection', () => {
  const originalEnv = process.env.MOCK_GRADING_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MOCK_GRADING_PROVIDER;
    else process.env.MOCK_GRADING_PROVIDER = originalEnv;
    vi.unstubAllEnvs();
  });

  it('MOCK_GRADING_PROVIDER=1 selects the fake provider — zero network calls', () => {
    process.env.MOCK_GRADING_PROVIDER = '1';
    const provider = createGradingProvider();
    expect(provider.name).toBe('fake');
  });

  it('MOCK_GRADING_PROVIDER unset selects Mistral (ADR-4 primary) — no import-time throw even with no MISTRAL_API_KEY configured', () => {
    delete process.env.MOCK_GRADING_PROVIDER;
    const previousKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      const provider = createGradingProvider();
      expect(provider.name).toBe('mistral');
    } finally {
      if (previousKey !== undefined) process.env.MISTRAL_API_KEY = previousKey;
    }
  });

  it('any value other than the literal "1" does not select the fake provider', () => {
    process.env.MOCK_GRADING_PROVIDER = 'true';
    expect(createGradingProvider().name).toBe('mistral');
  });
});
