import type { Metadata } from 'next';
import { z } from 'zod';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { SignInForm } from '@/components/guest/SignInForm';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'chrome.guest.signIn' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // noindex comes from (guest)/layout.tsx — see the landing page's comment.
  };
}

/**
 * Sign in (KAN-55) — the other end of `POST /api/auth/login` (KAN-20); see
 * `SignInForm` for what it must not do. Not a step of the guest essay flow, so
 * no progress indicator.
 *
 * `?essay=<id>` is how the register page says which report the person came
 * from. It is read here and accepted only as a UUID — the same guard, and the
 * same reasoning, as the register page: what reaches the form is a well-formed
 * id or nothing, and the form builds the landing route from it, so the
 * destination is never a caller-supplied path (no open redirect: there is no
 * path to supply). It is not checked against ownership here; signing in adopts
 * the guest essay the browser holds (KAN-52), and the preview page it lands on
 * does the ownership read and 404s for an essay that is not the account's.
 * Without it the form lands on the practice landing page.
 *
 * Reading `searchParams` makes this route dynamic, so it is no longer
 * prerendered — which is also what keeps the guest-session cookie the
 * middleware sets on it from being cached with the page.
 *
 * Links TO registration, and registration links back here.
 */
export default async function SignInPage({
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
  const t = await getTranslations('chrome.guest.signIn');

  return (
    <GuestFlowShell steps={[]} currentStepId="none" backHref={essayId ? `/practice/preview?essay=${essayId}` : '/practice'}>
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
        <div className="mt-6">
          <SignInForm
            essayId={essayId}
            strings={{
              emailLabel: t('emailLabel'),
              emailRequiredError: t('emailRequiredError'),
              emailInvalidError: t('emailInvalidError'),
              passwordLabel: t('passwordLabel'),
              passwordRequiredError: t('passwordRequiredError'),
              passwordTooLongError: t('passwordTooLongError'),
              submitCta: t('submitCta'),
              submittingCta: t('submittingCta'),
              successTitle: t('successTitle'),
              successBody: t('successBody'),
              errorGeneric: t('errorGeneric'),
              invalidCredentialsError: t('invalidCredentialsError'),
              rateLimitedError: t('rateLimitedError'),
            }}
          />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          {t('registerPrompt')}{' '}
          <Link
            href={essayId ? { pathname: '/register', query: { essay: essayId } } : '/register'}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {t('registerLink')}
          </Link>
        </p>
      </div>
    </GuestFlowShell>
  );
}
