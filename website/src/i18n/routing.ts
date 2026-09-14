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
 *
 * `localeDetection: false` — a deliberate departure from next-intl's
 * default, decided by Irina on 2026-09-14.
 *
 * With detection on, the middleware negotiates from the request's
 * `Accept-Language` header, so a German-browser guest asking for `/practice`
 * was redirected to `/de/practice`. Friendlier, but it means a URL that
 * already names a locale does not reliably serve that locale.
 *
 * The deciding factor was caching, not preference. Once the guest pages
 * became genuinely prerendered, `/practice` started serving with a long
 * shared-cache lifetime while its body still depended on a request header
 * that `Vary` does not name. A shared cache in front of Cloud Run could
 * therefore hand a stored English page — and its `NEXT_LOCALE` cookie — to a
 * German visitor, pinning the wrong language for them. Turning detection off
 * makes `/practice` unambiguously English, so the cached copy is correct for
 * everyone and the hazard disappears rather than being mitigated.
 *
 * The locale switcher still works: it sets the cookie and navigates, which
 * is an explicit choice rather than an inferred one.
 */
export const routing = defineRouting({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
