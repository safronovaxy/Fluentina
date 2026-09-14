import { describe, it, expect, vi } from 'vitest';
import { IntlError, IntlErrorCode } from 'next-intl';
import type { GetRequestConfigParams } from 'next-intl/server';

/**
 * `next-intl/server`'s package "exports" map picks a real, RSC-only
 * implementation of `getRequestConfig` under Next.js's own bundler (which
 * sets the `react-server` resolution condition), and a stub that throws
 * "not supported in Client Components" everywhere else — including under
 * Vite/Vitest, which has no reason to know about that condition. Mocking it
 * here isn't papering over that: `getRequestConfig`'s real, `react-server`
 * implementation is a one-line identity function (`(fn) => fn` — see
 * node_modules/next-intl/.../server/react-server/getRequestConfig.js), so
 * this mock IS that implementation, not a stand-in for it. What's actually
 * under test is `src/i18n/request.ts`'s own callback (locale resolution,
 * `timeZone`, `onError`/`getMessageFallback` wiring) — this is the only way
 * to invoke it directly, rather than through a mocked *client* provider, as
 * the original PR's only fail-loud test did.
 */
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}));

const getRequestConfigForLocale = (await import('./request')).default;

/**
 * KAN-9 — a review found that nothing imported `@/i18n/request`, invoked
 * its config, or constructed a missing key against `getTranslations`: the
 * only fail-loud test in the original PR went through the *client* provider
 * (IntlProvider) twice, so the Server Component / `getTranslations` half —
 * the one that actually renders the guest flow's landing page — had zero
 * coverage. Deleting both hooks from request.ts left every existing test
 * green while the server-rendered heading would show a raw catalogue key.
 *
 * `getRequestConfig(callback)` (next-intl/server) returns the same callback
 * it was given — see node_modules/next-intl's own type signature — so the
 * default export here is directly callable with a `GetRequestConfigParams`.
 */
function requestLocale(locale: string | undefined): GetRequestConfigParams {
  return { requestLocale: Promise.resolve(locale) };
}

describe('src/i18n/request.ts — server-side request config (KAN-9)', () => {
  it('resolves to the requested locale and loads its message catalogue', async () => {
    const config = await getRequestConfigForLocale(requestLocale('de'));
    expect(config.locale).toBe('de');
    expect((config.messages as Record<string, any>).chrome.guest.landing.title).toBe(
      'Übe einen B2-Aufsatz',
    );
  });

  it('falls back to the default locale for an unsupported/unknown one', async () => {
    const config = await getRequestConfigForLocale(requestLocale('fr'));
    expect(config.locale).toBe('en');
  });

  it('sets a global timeZone (BLOCKING regression guard: without one, the first server render in a fresh process trips next-intl\'s ENVIRONMENT_FALLBACK advisory)', async () => {
    const config = await getRequestConfigForLocale(requestLocale('en'));
    expect(config.timeZone).toBeTruthy();
  });

  it('onError throws for a broken-catalogue code — the fail-loud acceptance criterion, exercised against the real config, not a mock', async () => {
    const config = await getRequestConfigForLocale(requestLocale('en'));
    expect(() =>
      config.onError!(new IntlError(IntlErrorCode.MISSING_MESSAGE, 'chrome.guest.progressLabel')),
    ).toThrow('chrome.guest.progressLabel');
  });

  it('onError does NOT throw for ENVIRONMENT_FALLBACK — the exact bug that 500\'d the first guest request to a fresh server process', async () => {
    const config = await getRequestConfigForLocale(requestLocale('en'));
    expect(() =>
      config.onError!(
        new IntlError(IntlErrorCode.ENVIRONMENT_FALLBACK, "no timeZone configured"),
      ),
    ).not.toThrow();
  });

  it('getMessageFallback throws for a missing key, naming the full "namespace.key" path', async () => {
    const config = await getRequestConfigForLocale(requestLocale('en'));
    expect(() =>
      config.getMessageFallback!({
        error: new IntlError(IntlErrorCode.MISSING_MESSAGE, 'missing'),
        key: 'progressLabel',
        namespace: 'chrome.guest',
      }),
    ).toThrow('Missing translation for "chrome.guest.progressLabel"');
  });
});
