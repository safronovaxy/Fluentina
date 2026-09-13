import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * KAN-9 — per-request message loading for the App Router's Server Component
 * tree (`getTranslations`) and, via `NextIntlClientProvider`, for Client
 * Components (`useTranslations`).
 *
 * IMPORTANT — scope boundary (NFR §8 Language / Confluence guest-flow spec):
 * everything under `src/messages/**` is UI CHROME ONLY — labels, headings,
 * buttons, aria text. Essay prompts, submitted essay text and AI grading
 * output are German by definition and must never be looked up here. That
 * boundary isn't just this comment: `eslint.config.js` restricts which
 * directories may import `next-intl` at all (see the `no-restricted-imports`
 * block there), and grading output is produced exclusively through the
 * `GradingProvider` abstraction, which has no dependency on this module.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Fail loudly on a missing/unknown key (KAN-9 acceptance criterion).
    // next-intl's default is to log via console.error and render the raw
    // "namespace.key" string as the fallback — i.e. ship a bug silently to
    // a guest. Throwing turns that into a build-time-discoverable error
    // instead. This is the Server Component / `getTranslations` half; the
    // Client Component half is the same policy in
    // src/components/IntlProvider.tsx (functions aren't serialisable across
    // the server/client boundary, so it can't just be passed down from here).
    onError(error) {
      throw error;
    },
    getMessageFallback({ namespace, key }) {
      throw new Error(`Missing translation for "${[namespace, key].filter(Boolean).join('.')}"`);
    },
  };
});
