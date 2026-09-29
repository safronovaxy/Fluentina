import type { Metadata } from 'next';
import { z } from 'zod';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { RegistrationForm } from '@/components/guest/RegistrationForm';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'chrome.guest.register' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // noindex comes from (guest)/layout.tsx — see the landing page's comment.
  };
}

/**
 * Registration (KAN-55, BR-4.2) — the last step of the guest flow and the end
 * of the locked report's call to action. The form is the other end of
 * `POST /api/auth/register` (KAN-20); see `RegistrationForm` for everything it
 * does and refuses to do.
 *
 * `?essay=<id>` is how the report's CTA says which report to come back to. It
 * is read here and accepted only as a UUID — the same shape the preview page
 * requires — so what reaches the form is either a well-formed id or nothing,
 * and the form builds the landing route from it rather than following a path
 * the caller supplied. It is NOT checked against ownership here: the preview
 * page it leads to does that read (and 404s for an essay that is not yours),
 * and a second, weaker copy of that check on this page would be one more
 * place to keep in step. Without it the person lands on the practice landing
 * page after registering.
 *
 * Its own route with no data read, so nothing here depends on a guest session
 * existing and `<GuestSessionBootstrap>` is not rendered: registration
 * converts a session if the cookie names one and works without.
 *
 * Deliberately no "already have an account? Sign in" link. A guest who signs
 * in to an existing account has their guest-owned essay orphaned (KAN-52,
 * `resolveOwnerActor` resolves the registered session first and never looks
 * at the guest cookie), so that link would walk people who have an essay
 * straight into it. Add it once KAN-52 is fixed.
 */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ essay?: string | string[] }>;
}) {
  const { locale } = await params;
  const { essay: essayParam } = await searchParams;
  setRequestLocale(locale);
  const parsedEssay = z.string().uuid().safeParse(essayParam);
  const essayId = parsedEssay.success ? parsedEssay.data : undefined;

  const t = await getTranslations('chrome.guest.register');

  return (
    <GuestFlowShell
      steps={GUEST_FLOW_STEPS}
      currentStepId="register"
      backHref={essayId ? `/practice/preview?essay=${essayId}` : '/practice'}
    >
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
        <div className="mt-6">
          <RegistrationForm
            essayId={essayId}
            strings={{
              emailLabel: t('emailLabel'),
              emailRequiredError: t('emailRequiredError'),
              emailInvalidError: t('emailInvalidError'),
              passwordLabel: t('passwordLabel'),
              passwordHint: t('passwordHint'),
              passwordRequiredError: t('passwordRequiredError'),
              passwordTooShortError: t('passwordTooShortError'),
              passwordTooLongError: t('passwordTooLongError'),
              requiredConsentLegend: t('requiredConsentLegend'),
              optionalConsentLegend: t('optionalConsentLegend'),
              consent: {
                termsOfService: {
                  label: t('consent.termsOfService.label'),
                  linkText: t('consent.termsOfService.linkText'),
                  requiredError: t('consent.termsOfService.requiredError'),
                },
                privacyPolicy: {
                  label: t('consent.privacyPolicy.label'),
                  linkText: t('consent.privacyPolicy.linkText'),
                  requiredError: t('consent.privacyPolicy.requiredError'),
                },
                ageDeclaration16Plus: {
                  label: t('consent.ageDeclaration16Plus.label'),
                  requiredError: t('consent.ageDeclaration16Plus.requiredError'),
                },
                marketingEmail: { label: t('consent.marketingEmail.label') },
              },
              submitCta: t('submitCta'),
              submittingCta: t('submittingCta'),
              successTitle: t('successTitle'),
              successBody: t('successBody'),
              errorGeneric: t('errorGeneric'),
              invalidSubmissionError: t('invalidSubmissionError'),
              rateLimitedError: t('rateLimitedError'),
              emailAlreadyRegisteredError: t('emailAlreadyRegisteredError'),
            }}
          />
        </div>
      </div>
    </GuestFlowShell>
  );
}
