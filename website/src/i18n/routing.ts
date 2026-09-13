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
 * `localeDetection: true` (next-intl's default — stated explicitly here,
 * not left implicit) means the middleware also negotiates from the
 * request's `Accept-Language` header (and a `NEXT_LOCALE` cookie once one
 * has been set, e.g. by the locale switcher): a German-browser guest
 * requesting the *unprefixed* default-locale URL (`/practice`) is
 * redirected to `/de/practice`, same as a French-browser guest would be if
 * `fr` existed. That is a real product question — is a browser's language
 * preference allowed to override a URL that already unambiguously names a
 * locale? — not one this story is answering; it's flagged separately. This
 * comment and the test pinning it (tests/guest-flow-i18n.spec.ts) exist so
 * the current, default behaviour is visible and intentional-looking rather
 * than an unstated side effect someone has to rediscover by reading
 * next-intl's source.
 */
export const routing = defineRouting({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: true,
});

export type AppLocale = (typeof routing.locales)[number];
