import Link from 'next/link';
import { PenTool } from 'lucide-react';
import { StepIndicator, type GuestFlowStep } from './StepIndicator';
import { cn } from '@/lib/utils';

export interface GuestFlowShellProps {
  children: React.ReactNode;
  steps: GuestFlowStep[];
  currentStepIndex: number;
  /** Extra classes for the content wrapper — most pages won't need this. */
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
  currentStepIndex,
  contentClassName,
}: GuestFlowShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
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
          <StepIndicator steps={steps} currentStepIndex={currentStepIndex} />
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
