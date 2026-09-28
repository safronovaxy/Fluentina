import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { GradingPreview } from '@/components/guest/GradingPreview';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';
import { guestSessionIdSchema, type GuestActor } from '@/lib/contracts/actor';
import { getOwnedEssay } from '@/lib/domain/essay-read';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'chrome.guest.preview' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // noindex comes from (guest)/layout.tsx — see the landing page's comment.
  };
}

/**
 * Guest score preview (KAN-18, BR-4.1) — the screen a guest lands on right
 * after submitting an essay: overall band score and one worked example from
 * their own text, as soon as grading finishes. `currentStepId="preview"` is
 * the canonical step this has always been reserved for in
 * `GUEST_FLOW_STEPS`; no step was inserted or renumbered (see
 * StepIndicator's comment on why that matters).
 *
 * Its own route, not a state of `/practice/write`: the step indicator is
 * per-screen (server-rendered), the result survives a reload and a
 * back-button round trip because the essay id is in the URL, and the essay
 * text the annotations index into is read here on the server rather than
 * kept in browser state that a reload would lose.
 *
 * The id is a `?essay=` query parameter, not a `[essayId]` path segment, on
 * purpose: `src/middleware.test.ts` refuses any dynamic route under this
 * tree (a bracketed path is not matcher syntax, and its guard exists because
 * that once shipped an unprefixed URL that 404'd), and the honest way past
 * it is a static route with its matcher entries added by hand, not loosening
 * a guard this story does not own.
 *
 * Ownership: the essay is read through `getOwnedEssay` with an actor built
 * from the guest cookie, and the grading poll the client makes is the same
 * ownership-scoped `GET /api/essays/[id]/grading`. A missing cookie, a
 * missing or malformed id, someone else's essay and a nonexistent one are all the same
 * 404 — the "not found and not yours are outwardly identical" rule the rest
 * of this flow applies. Reading `cookies()` makes this page dynamic, which
 * is right for a page whose content is one guest's essay.
 *
 * `<GuestSessionBootstrap>` is deliberately not rendered: reaching this
 * screen requires an essay, so the session row already exists.
 */
export default async function GuestPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ essay?: string | string[] }>;
}) {
  const { locale } = await params;
  const { essay: essayParam } = await searchParams;
  // `?essay=a&essay=b` arrives as an array — never a valid id.
  const essayId = typeof essayParam === 'string' ? essayParam : '';
  setRequestLocale(locale);

  const cookieParse = guestSessionIdSchema.safeParse((await cookies()).get(GUEST_SESSION_COOKIE_NAME)?.value);
  if (!cookieParse.success || !z.string().uuid().safeParse(essayId).success) notFound();

  const actor: GuestActor = { kind: 'guest', sessionId: cookieParse.data };
  const essay = await getOwnedEssay(actor, essayId);
  if (!essay) notFound();

  const t = await getTranslations('chrome.guest.preview');

  return (
    <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepId="preview">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
        <div className="mt-6">
          <GradingPreview
            essayId={essay.id}
            essayContent={essay.content}
            tryAgainAction={
              <Button asChild>
                <Link href="/practice/write">{t('tryAgainCta')}</Link>
              </Button>
            }
            strings={{
              pendingTitle: t('pendingTitle'),
              pendingBody: t('pendingBody'),
              completeTitle: t('completeTitle'),
              completeAnnouncement: t('completeAnnouncement'),
              scoreOutOf: t('scoreOutOf'),
              bandLabel: t('bandLabel'),
              bands: {
                strongPass: t('bands.strongPass'),
                pass: t('bands.pass'),
                borderline: t('bands.borderline'),
                belowTarget: t('bands.belowTarget'),
                belowB1: t('bands.belowB1'),
              },
              exampleTitle: t('exampleTitle'),
              exampleIntro: t('exampleIntro'),
              errorMarkerStart: t('errorMarkerStart'),
              errorMarkerEnd: t('errorMarkerEnd'),
              explanationLabel: t('explanationLabel'),
              suggestionLabel: t('suggestionLabel'),
              noExample: t('noExample'),
              flaggedTitle: t('flaggedTitle'),
              flaggedBody: t('flaggedBody'),
              stalledTitle: t('stalledTitle'),
              stalledBody: t('stalledBody'),
              failedTitle: t('failedTitle'),
              failedBody: t('failedBody'),
              failedReasons: {
                wordCountOutOfBounds: t('failedReasons.wordCountOutOfBounds'),
                providerError: t('failedReasons.providerError'),
                invalidProviderResponse: t('failedReasons.invalidProviderResponse'),
                essayMissing: t('failedReasons.essayMissing'),
                unknown: t('failedReasons.unknown'),
              },
              pollErrorTitle: t('pollErrorTitle'),
              pollErrorBody: t('pollErrorBody'),
              pollErrorNotFoundBody: t('pollErrorNotFoundBody'),
              retryCta: t('retryCta'),
            }}
          />
        </div>
      </div>
    </GuestFlowShell>
  );
}
