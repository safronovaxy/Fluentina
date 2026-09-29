import type { Metadata } from 'next';
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
 * Reads no query parameters: no `?essay=` and no return path. A guest who signs
 * in to an existing account has their guest-owned essay orphaned (KAN-52), so
 * carrying an essay id through here would land them on a 404, and a
 * caller-supplied return path is an open redirect this page has no reason to
 * take on. The form lands on the practice landing page.
 *
 * Links TO registration, and registration deliberately does not link back:
 * see that page's comment.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('chrome.guest.signIn');

  return (
    <GuestFlowShell steps={[]} currentStepId="none" backHref="/practice">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
        <div className="mt-6">
          <SignInForm
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
          <Link href="/register" className="font-medium text-foreground underline underline-offset-2">
            {t('registerLink')}
          </Link>
        </p>
      </div>
    </GuestFlowShell>
  );
}
