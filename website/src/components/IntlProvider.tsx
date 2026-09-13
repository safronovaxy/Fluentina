'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { onIntlError, intlMessageFallback } from '@/i18n/errorPolicy';

/**
 * Thin wrapper around `NextIntlClientProvider` (KAN-9).
 *
 * This is a separate Client Component, rather than the guest locale layout
 * (a Server Component) rendering `<NextIntlClientProvider>` directly with
 * inline `onError`/`getMessageFallback` props, because those props are
 * functions, and functions cannot cross the Server → Client Component
 * boundary as props. Defining them here, and only forwarding the plain,
 * serialisable `locale`/`messages`/`timeZone` data down from the server
 * layout, is the shape Next.js requires for that split.
 *
 * `onError`/`getMessageFallback` come from `@/i18n/errorPolicy`, the same
 * shared functions `src/i18n/request.ts` (the Server Component /
 * `getTranslations` half) uses — a review found the two halves had
 * previously been hand-copied, identical at the time but with nothing
 * stopping them drifting apart, which would mean a missing key failing
 * loudly on the server and silently in the browser, or vice versa.
 * Importing the same functions here removes that possibility rather than
 * relying on the two staying in sync by convention.
 *
 * `timeZone` is forwarded from the server layout (which reads it back via
 * `getTimeZone()`, populated by the global default in `src/i18n/
 * request.ts`) so the client and server halves of a hydrated tree agree —
 * without it, the browser would hit the same `ENVIRONMENT_FALLBACK`
 * advisory `request.ts`'s comment describes, just on the client instead of
 * the server.
 */
export function IntlProvider({
  locale,
  messages,
  timeZone,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  timeZone?: string;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={onIntlError}
      getMessageFallback={intlMessageFallback}
    >
      {children}
    </NextIntlClientProvider>
  );
}
