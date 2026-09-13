import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getMessages, getTimeZone, setRequestLocale } from 'next-intl/server';
import { IntlProvider } from '@/components/IntlProvider';
import { routing } from '@/i18n/routing';

/**
 * Root of the locale-aware part of the app tree (KAN-9). Today that's only
 * the guest essay flow, nested below as `(guest)` — see this story's scope
 * note: the marketing site deliberately stays outside `[locale]` rather than
 * being moved wholesale under it, so this layout's only job is to make the
 * `[locale]` param a real, request-scoped locale for whatever it wraps.
 *
 * `generateStaticParams` + `setRequestLocale` is next-intl's documented pair
 * for making pages under `[locale]` statically renderable per locale rather
 * than falling back to fully dynamic rendering just because they read the
 * locale from a route param — but that pairing has to be repeated in every
 * Server Component actually on the page's render path, not just here. A
 * review found this layout calling `setRequestLocale` while `practice/
 * page.tsx` did not, and per next-intl's own model each Server Component in
 * the tree can be invoked independently during static generation, so the
 * page fell through to reading the locale from request headers and bailed
 * the whole route to dynamic rendering — verified on a clean build: no
 * prerender-manifest entry for either locale. See `practice/page.tsx` for
 * the matching call this layout's presence here does not make redundant.
 *
 * `IntlProvider` (our `NextIntlClientProvider` wrapper) is only needed for
 * the Client Component half of the split (e.g. `LocaleSwitcher`, which needs
 * `useLocale`/`useTranslations` in the browser to re-render on navigation) —
 * Server Components under this tree can call `useTranslations`/
 * `getTranslations` directly without it. `timeZone` is read back with
 * `getTimeZone()` (populated by the global default in `src/i18n/
 * request.ts`) and forwarded down, so the client half agrees with the
 * server half rather than falling back to its own default.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const [messages, timeZone] = await Promise.all([getMessages(), getTimeZone()]);

  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </IntlProvider>
  );
}
