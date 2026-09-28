import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { GuestSessionBootstrap } from '@/components/guest/GuestSessionBootstrap';
import { EssayEntryForm } from '@/components/guest/EssayEntryForm';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'chrome.guest.write' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // Deliberately not restated — (guest)/layout.tsx is the single source
    // for this segment's noindex; see the landing page's own comment on
    // this same pattern for the review finding behind it.
  };
}

/**
 * Guest essay entry (KAN-14). The first concrete screen in the flow after
 * the landing page — prompt selection (KAN-13) doesn't exist yet, so the
 * landing CTA links straight here rather than to an intermediate step that
 * isn't built. `currentStepId="write"` reflects that honestly: it is the
 * step actually being shown, not a claim that "Prompt" was completed.
 *
 * One known, deliberate rough edge from building the flow out of its
 * canonical order: StepIndicator marks every step before `currentStepId`
 * as complete (a checkmark), so "Prompt" renders as done even though no
 * prompt-selection screen exists to have completed. Worth a look once
 * KAN-13 lands — whether the indicator should distinguish "skipped because
 * not built yet" from "completed" — but not a change this story makes to
 * shared chrome for a temporary, single-screen gap.
 *
 * `backHref="/practice"` — back to the landing page, the only earlier
 * screen that exists; GuestFlowShell's own comment names prompt selection
 * as the intended eventual back target once KAN-13 exists.
 *
 * Text entry only (KAN-14 AC): `EssayEntryForm` renders a single textarea
 * and nothing else — no file input, no camera capture, no OCR. See that
 * component's own comment for why it is a plain, non-chrome Client
 * Component that takes its strings as props rather than calling
 * `useTranslations` itself.
 *
 * `<GuestSessionBootstrap>` (KAN-10) is rendered here too, same as the
 * landing page — best-effort only; `POST /api/essays` calls
 * `resolveGuestSession` itself and does not depend on this having run (see
 * both components' own comments).
 */
export default async function EssayEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('chrome.guest.write');

  return (
    <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepId="write" backHref="/practice">
      <GuestSessionBootstrap />
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
        <div className="mt-6">
          <EssayEntryForm
            strings={{
              textareaLabel: t('textareaLabel'),
              placeholder: t('placeholder'),
              requiredError: t('requiredError'),
              recommendedRangeGuidance: t('recommendedRangeGuidance'),
              lengthWarning: t('lengthWarning'),
              tooShortError: t('tooShortError'),
              tooLongError: t('tooLongError'),
              submitCta: t('submitCta'),
              submittingCta: t('submittingCta'),
              successTitle: t('successTitle'),
              successBody: t('successBody'),
              errorGeneric: t('errorGeneric'),
              rateLimitedError: t('rateLimitedError'),
            }}
          />
        </div>
      </div>
    </GuestFlowShell>
  );
}
