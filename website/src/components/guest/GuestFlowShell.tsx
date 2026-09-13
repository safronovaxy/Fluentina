import Link from 'next/link';
import { PenTool } from 'lucide-react';
import { StepIndicator } from './StepIndicator';
import { type GuestFlowStep, type GuestFlowStepId } from './flow-steps';
import { cn } from '@/lib/utils';

export interface GuestFlowShellProps {
  children: React.ReactNode;
  /** Defaults to GUEST_FLOW_STEPS. Pass [] on screens with no progress bar. */
  steps?: readonly GuestFlowStep[];
  /** Step id, or 'none' before the flow starts. See StepIndicator. */
  currentStepId: GuestFlowStepId | 'none';
  /**
   * Extra classes for the content wrapper — most pages won't need this.
   *
   * Merged with tailwind-merge, so a conflicting utility REPLACES the
   * default rather than stacking: passing `max-w-5xl` drops `max-w-3xl`,
   * and `px-0` drops the `px-4` gutter. That is intended, and pinned by a
   * test, so the next story finds out at test time rather than in review.
   */
  contentClassName?: string;
}

/**
 * Shared responsive chrome for every screen in the guest essay-submission
 * flow — landing, prompt selection, essay entry, submission, preview, and
 * registration (KAN-8 AC: "delivered as a reusable layout/component
 * foundation the other guest-flow stories build on").
 *
 * No marketing Header/Footer (mirrors the existing placement-test flow
 * layout) — this is a focused, single-task screen, not a marketing page.
 * Deliberately web-only/responsive, no native-app dependency (BR-1.2 /
 * NFR §8 Platform): a slim top bar plus a content column that's full-width
 * with safe padding on phones and caps out at a comfortable reading width
 * on desktop, so the same markup works unmodified at both sizes.
 */
export function GuestFlowShell({
  children,
  steps,
  currentStepId,
  contentClassName,
}: GuestFlowShellProps) {
  return (
    // min-h-dvh, not min-h-screen: 100vh on iOS Safari and Chrome Android is
    // the *large* viewport height, which ignores the visible URL bar, so a
    // short page scrolls for no reason and a bottom-anchored control would
    // sit under the browser chrome.
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 font-semibold text-foreground"
            aria-label="Fluentina home"
          >
            <PenTool className="h-5 w-5 text-primary" aria-hidden />
            <span className="hidden sm:inline">Fluentina</span>
          </Link>
          <StepIndicator steps={steps} currentStepId={currentStepId} />
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-10',
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
