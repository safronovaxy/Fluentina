'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

/**
 * Thin wrapper around `NextIntlClientProvider` (KAN-9).
 *
 * This is a separate Client Component, rather than the guest locale layout
 * (a Server Component) rendering `<NextIntlClientProvider>` directly with
 * inline `onError`/`getMessageFallback` props, because those props are
 * functions, and functions cannot cross the Server → Client Component
 * boundary as props. Defining them here, and only forwarding the plain,
 * serialisable `locale`/`messages` data down from the server layout, is
 * the shape Next.js requires for that split.
 *
 * Same fail-loudly policy as src/i18n/request.ts (the Server Component /
 * `getTranslations` half of this story's missing-key test) — kept in sync
 * deliberately, not just by convention: a mismatch would mean a missing key
 * fails loudly on the server and silently in the browser, or vice versa.
 */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`Missing translation for "${[namespace, key].filter(Boolean).join('.')}"`);
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
