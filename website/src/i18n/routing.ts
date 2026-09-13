import { defineRouting } from 'next-intl/routing';

/**
 * KAN-9 — i18n routing configuration.
 *
 * Locales are the two the product ships with at launch (NFR §8 Language).
 * Adding a third locale later (e.g. `fr`) is a one-line change here plus a
 * new `src/messages/fr.json` — nothing about routing, the middleware or the
 * `[locale]` segment needs restructuring. That is the "no structural rework"
 * half of this story's acceptance criteria.
 *
 * `localePrefix: 'as-needed'` (rather than `'always'`) keeps the default
 * locale's URLs exactly as they are today — `/practice`, not `/en/practice`
 * — so nothing that already links to or tests the guest flow's existing
 * paths needed to change. Only German gets a visible prefix (`/de/practice`).
 * next-intl's middleware still enforces one canonical URL per locale: a
 * request for the prefixed default-locale path (`/en/practice`) redirects to
 * the unprefixed one, so the two never both serve as duplicate content.
 */
export const routing = defineRouting({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type AppLocale = (typeof routing.locales)[number];
