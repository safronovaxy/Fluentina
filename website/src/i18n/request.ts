import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { onIntlError, intlMessageFallback } from './errorPolicy';

/**
 * A fixed global default, not per-user detection: this story's guest flow
 * chrome has no date/time formatting yet, so there's no product decision
 * being made about which timezone a guest actually sees times in — this
 * exists purely to give `use-intl` a configured default so it doesn't have
 * to fall back to one at request time (see the `onError` note below).
 * Revisit when a story actually renders a time (e.g. KAN-16's "graded N
 * minutes ago") and per-user timezone starts to matter.
 */
const DEFAULT_TIME_ZONE = 'Europe/Berlin';

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
    // Without this, `use-intl` falls back to no timezone and raises its own
    // `ENVIRONMENT_FALLBACK` advisory the first time *any* translation runs
    // server-side in a process that hasn't rendered one yet — i.e. every
    // cold start of a scale-to-zero Cloud Run instance. A previous version
    // of this file rethrew every `IntlError` regardless of code, which
    // turned that one-line advisory into a 500 on the guest flow's own
    // entry page for the first request any fresh process received. Setting
    // a global default removes the advisory at its source; `onError` below
    // is the second, defence-in-depth layer for whichever advisory code a
    // future `format` call still produces (see src/i18n/errorPolicy.ts).
    timeZone: DEFAULT_TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Fail loudly on a missing/unknown key (KAN-9 acceptance criterion), but
    // only for codes that actually mean the catalogue is broken — see
    // src/i18n/errorPolicy.ts for the full reasoning and the fatal/advisory
    // split. Once every page in this locale's route also calls
    // `setRequestLocale` (see `src/app/[locale]/layout.tsx` and
    // `practice/page.tsx`), the guest flow's two locale variants are
    // actually prerendered at build time, so a genuinely missing key here
    // is a build-time-discoverable error, not just a runtime one. This is
    // the Server Component / `getTranslations` half; the Client Component
    // half is the same policy, via the same shared functions, in
    // src/components/IntlProvider.tsx (functions aren't serialisable across
    // the server/client boundary, so it can't just be passed down from
    // here — hence a shared module both sides import, rather than either
    // side importing the other).
    onError: onIntlError,
    getMessageFallback: intlMessageFallback,
  };
});
