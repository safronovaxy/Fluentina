import type { Metadata } from 'next';
import { PenTool, Clock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuestFlowShell } from '@/components/guest/GuestFlowShell';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';

export const metadata: Metadata = {
  title: 'Practice a B2 essay',
  description:
    'Write a B2-level German essay and get instant, AI-graded feedback against the Goethe exam rubric — no account needed to see your score.',
  robots: { index: false, follow: false }, // no functioning flow behind it yet
};

/**
 * Guest flow landing page (KAN-8). This is the first concrete screen built
 * on the GuestFlowShell/StepIndicator foundation — proof that the shell
 * renders and functions on both mobile and desktop web (AC1/AC2).
 *
 * The remaining flow stages (prompt selection — KAN-13, essay entry —
 * KAN-14, submission/grading — KAN-16, preview — KAN-18, registration —
 * KAN-20/21) are separate backlog stories that nest their own pages under
 * this same (guest) layout and reuse this shell; the primary CTA here is
 * intentionally disabled until the first of those (after KAN-10's guest
 * session/data foundation) exists to link to, rather than pointing at a
 * dead or fake route.
 */
export default function GuestPracticeLandingPage() {
  return (
    <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepIndex={-1}>
      <div className="mx-auto max-w-xl text-center">
        <PenTool className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Practice a B2-style essay
        </h1>
        <p className="mt-3 text-muted-foreground">
          Pick a prompt or write freely, get an instant score against the
          Goethe B2 rubric with specific errors marked — no account needed
          to see how you did.
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <dt className="text-sm font-medium">Fast feedback</dt>
              <dd className="text-sm text-muted-foreground">
                Your score and one worked example, usually within a minute.
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <dt className="text-sm font-medium">Nothing to install</dt>
              <dd className="text-sm text-muted-foreground">
                Works right in your phone or desktop browser.
              </dd>
            </div>
          </div>
        </dl>

        <div className="mt-8">
          <Button size="lg" className="w-full sm:w-auto" disabled>
            Start practicing
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Prompt selection and essay entry are launching next (KAN-13/KAN-14).
          </p>
        </div>
      </div>
    </GuestFlowShell>
  );
}
