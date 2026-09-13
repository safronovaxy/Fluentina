import { render, type RenderOptions } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';

/**
 * Shared test helper (KAN-9) for rendering guest-flow components that call
 * `useTranslations`/`useLocale`. In the browser (and in jsdom, which looks
 * like a browser to next-intl — `typeof window !== 'undefined'`), those
 * hooks read from `NextIntlClientProvider`'s React context, so a bare
 * `render(<StepIndicator ... />)` throws "No intl context found" with no
 * wrapper at all.
 *
 * Wraps with our own `IntlProvider` (not a bare `NextIntlClientProvider`)
 * deliberately: that's the actual production wrapper, fail-loudly
 * `onError`/`getMessageFallback` included, so a test using
 * `renderWithIntl(..., { locale: 'de' })` with an incomplete `de.json` is
 * exercising the same failure path a real German user would hit, not a
 * reimplementation of it.
 */
const CATALOGUES = { en: enMessages, de: deMessages } as const;

export function renderWithIntl(
  ui: React.ReactElement,
  {
    locale = 'en',
    messages = CATALOGUES[locale as keyof typeof CATALOGUES],
    ...options
  }: RenderOptions & { locale?: 'en' | 'de'; messages?: AbstractIntlMessages } = {},
) {
  return render(
    <IntlProvider locale={locale} messages={messages}>
      {ui}
    </IntlProvider>,
    options,
  );
}
