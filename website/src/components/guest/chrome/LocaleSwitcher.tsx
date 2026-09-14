'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * EN/DE switcher for the guest flow (KAN-9). A Client Component — it needs
 * `useRouter`/`usePathname` to navigate, which only work in the browser —
 * demonstrating the other half of the server/client split from the
 * Server Component screens (`practice/page.tsx`, `GuestFlowShell`,
 * `StepIndicator`) that read translations directly with no client boundary
 * at all.
 *
 * `usePathname`/`useRouter` come from `@/i18n/navigation` (next-intl's
 * locale-aware wrappers), not plain `next/navigation`: `usePathname` returns
 * the path with any locale prefix already stripped, and
 * `router.replace(pathname, { locale })` re-adds the correct prefix for the
 * target locale — so switching locale on `/practice/prompt` (once that
 * route exists) goes to the same screen in the other language, not back to
 * the landing page, and does the right thing under `localePrefix:
 * 'as-needed'` (no prefix for `en`, `/de` for `de`) without this component
 * needing to know that policy itself.
 */
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('chrome.localeSwitcher');
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div role="group" aria-label={t('label')} className="flex items-center gap-1">
      {routing.locales.map((code) => {
        const isCurrent = code === locale;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={isCurrent}
            disabled={isCurrent}
            onClick={() => router.replace(pathname, { locale: code })}
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              isCurrent
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(code)}
          </button>
        );
      })}
    </div>
  );
}
