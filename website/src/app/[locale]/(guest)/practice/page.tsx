import type { Metadata } from 'next';
import { PenTool, Clock, ShieldCheck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'chrome.guest.landing' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // Deliberately NOT restated here — (guest)/layout.tsx is the single
    // source for this segment's noindex, and page metadata overrides layout
    // metadata field by field. A review found that restating an identical
    // `robots` block here meant deleting the layout's export entirely still
    // left both noindex tests green, so the segment-level guard — the one
    // whose whole purpose is protecting a future screen whose author
    // forgets to think about indexing — had no coverage at all.
  };
}

/**
 * Guest flow landing page (KAN-8, localised under KAN-9). This is the first
 * concrete screen built on the GuestFlowShell/StepIndicator foundation —
 * proof that the shell renders and functions on both mobile and desktop web
 * (AC1/AC2), and now also the worked example for i18n (KAN-9): every string
 * on this page comes from `chrome.guest.landing` in src/messages/{locale}.json,
 * not a literal, so it renders correctly in both EN and DE.
 *
 * The remaining flow stages (prompt selection — KAN-13, essay entry —
 * KAN-14, submission/grading — KAN-16, preview — KAN-18, registration —
 * KAN-20/21) are separate backlog stories that nest their own pages under
 * this same (guest) layout and reuse this shell; the primary CTA here is
 * intentionally disabled until the first of those (after KAN-10's guest
 * session/data foundation) exists to link to, rather than pointing at a
 * dead or fake route.
 *
 * `setRequestLocale(locale)` — a review found this missing was the reason
 * neither locale was actually prerendered: `[locale]/layout.tsx` calling it
 * is not enough on its own, since next-intl's static-rendering support
 * requires every Server Component actually on the render path to call it,
 * not just an ancestor layout. Without it here, this page fell through to
 * reading the locale from request headers, which bails the whole route to
 * fully dynamic rendering — verified on a clean build (no prerender-
 * manifest entry for either locale, empty locale output directories).
 */
export default async function GuestPracticeLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('chrome.guest.landing');

  return (
    <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepId="none">
      <div className="mx-auto max-w-xl text-center">
        <PenTool className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-muted-foreground">{t('description')}</p>

        <dl className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <dt className="text-sm font-medium">{t('fastFeedbackTitle')}</dt>
              <dd className="text-sm text-muted-foreground">{t('fastFeedbackBody')}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <dt className="text-sm font-medium">{t('noInstallTitle')}</dt>
              <dd className="text-sm text-muted-foreground">{t('noInstallBody')}</dd>
            </div>
          </div>
        </dl>

        <div className="mt-8">
          <Button size="lg" className="w-full sm:w-auto" disabled>
            {t('cta')}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">{t('ctaHint')}</p>
        </div>
      </div>
    </GuestFlowShell>
  );
}
