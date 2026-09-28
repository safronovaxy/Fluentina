/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGradingProvider } from './provider-factory';

describe('createGradingProvider — ADR-4 provider selection, amended by KAN-44', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
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

  it('with nothing set, selects Claude (the Phase 1 primary)', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', undefined);
    const provider = createGradingProvider();
    expect(provider.name).toBe('claude');
  });

  // The static import at the top of this file runs before any stub here, so
  // it only proves "no import-time throw" while the ambient environment
  // happens to lack the key — and `.env.example` invites a developer to put
  // one in `.env.local`, which vitest.config.ts loads. Importing afresh under
  // a stubbed environment makes the guarantee independent of that.
  it('importing the factory and constructing the Claude provider never needs ANTHROPIC_API_KEY — checked with a fresh import under an explicitly unset key', async () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', undefined);
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    vi.resetModules();

    const fresh = await import('./provider-factory');

    expect(fresh.createGradingProvider().name).toBe('claude');
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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createGradingProvider().name).toBe('claude');
  });

  // Falling back to Claude is the ~20x more expensive provider; a typo must
  // not do that silently. Same shape as rate-limit.ts's rejected-override
  // warning: an event name, the operator-typed raw value, what was selected.
  it('an unrecognised GRADING_PROVIDER logs one structured warning with the raw value and the provider selected', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', 'mistrall');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createGradingProvider();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({
      severity: 'WARNING',
      event: 'grading_provider_env_unrecognised',
      name: 'GRADING_PROVIDER',
      value: 'mistrall',
      selected: 'claude',
    });
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
    ['"claude"', 'claude'],
    ['"mistral"', 'mistral'],
  ])('does not warn when GRADING_PROVIDER is %s', (_label, value) => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', undefined);
    vi.stubEnv('GRADING_PROVIDER', value);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createGradingProvider();

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn about GRADING_PROVIDER when MOCK_GRADING_PROVIDER=1 wins over it', () => {
    vi.stubEnv('MOCK_GRADING_PROVIDER', '1');
    vi.stubEnv('GRADING_PROVIDER', 'mistrall');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(createGradingProvider().name).toBe('fake');
    expect(warn).not.toHaveBeenCalled();
  });
});
