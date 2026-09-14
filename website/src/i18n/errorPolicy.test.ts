import { describe, it, expect, vi } from 'vitest';
import { IntlError, IntlErrorCode } from 'next-intl';
import { isFatalIntlErrorCode, onIntlError, intlMessageFallback } from './errorPolicy';

/**
 * KAN-9 — direct tests of the shared fail-loud policy, so the server
 * (src/i18n/request.ts) and client (src/components/IntlProvider.tsx) halves
 * can't drift: both import these two functions rather than each defining
 * their own copy, so this file is the single place either failure mode is
 * pinned.
 */
describe('errorPolicy — fatal vs advisory IntlError codes (KAN-9)', () => {
  it('treats a missing/unknown/malformed catalogue key as fatal', () => {
    expect(isFatalIntlErrorCode(IntlErrorCode.MISSING_MESSAGE)).toBe(true);
    expect(isFatalIntlErrorCode(IntlErrorCode.INSUFFICIENT_PATH)).toBe(true);
    expect(isFatalIntlErrorCode(IntlErrorCode.INVALID_MESSAGE)).toBe(true);
  });

  it('treats next-intl\'s own advisory/formatting codes as non-fatal', () => {
    // ENVIRONMENT_FALLBACK in particular: this is the exact code that fires
    // on the first server-rendered translation in a process with no global
    // timeZone/now configured — one per cold start on a scale-to-zero
    // service — and rethrowing it 500'd the guest flow's entry page.
    expect(isFatalIntlErrorCode(IntlErrorCode.ENVIRONMENT_FALLBACK)).toBe(false);
    expect(isFatalIntlErrorCode(IntlErrorCode.MISSING_FORMAT)).toBe(false);
    expect(isFatalIntlErrorCode(IntlErrorCode.INVALID_KEY)).toBe(false);
    expect(isFatalIntlErrorCode(IntlErrorCode.FORMATTING_ERROR)).toBe(false);
  });

  describe('onIntlError', () => {
    it('throws for a fatal code — the "fail loudly on a broken catalogue" acceptance criterion', () => {
      expect(() =>
        onIntlError(new IntlError(IntlErrorCode.MISSING_MESSAGE, 'chrome.guest.progressLabel')),
      ).toThrow('chrome.guest.progressLabel');
    });

    it('does NOT throw for ENVIRONMENT_FALLBACK — the regression this story fixes', () => {
      const error = new IntlError(
        IntlErrorCode.ENVIRONMENT_FALLBACK,
        "The `timeZone` parameter wasn't provided",
      );
      const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => onIntlError(error)).not.toThrow();
      // Not silent either — logged for visibility, just not crashed.
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ENVIRONMENT_FALLBACK'));
      logSpy.mockRestore();
    });
  });

  describe('intlMessageFallback', () => {
    it('throws with the missing key path for a fatal code', () => {
      const error = new IntlError(IntlErrorCode.MISSING_MESSAGE, 'missing');
      expect(() =>
        intlMessageFallback({ error, key: 'progressLabel', namespace: 'chrome.guest' }),
      ).toThrow('Missing translation for "chrome.guest.progressLabel"');
    });

    it('does not throw for a non-fatal code, returning the raw key path instead', () => {
      const error = new IntlError(IntlErrorCode.FORMATTING_ERROR, 'formatting issue');
      expect(
        intlMessageFallback({ error, key: 'progressLabel', namespace: 'chrome.guest' }),
      ).toBe('chrome.guest.progressLabel');
    });
  });
});
