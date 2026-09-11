import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GuestFlowStep {
  /** Stable identifier, e.g. "prompt" — used as the React key and for tests. */
  id: string;
  /** Short label shown on desktop / tablet, e.g. "Choose prompt". */
  label: string;
}

export interface StepIndicatorProps {
  steps: GuestFlowStep[];
  /** Zero-based index of the step currently in progress. */
  currentStepIndex: number;
  className?: string;
}

/**
 * Progress indicator for the guest essay-submission flow (KAN-8 — the
 * reusable foundation the rest of the guest-flow stories, KAN-13 onward,
 * build on).
 *
 * Responsive by design, not by hiding content: every step keeps an
 * always-visible numbered dot (small enough to fit six steps on a narrow
 * phone screen without wrapping or overflowing), and the text label is
 * shown alongside it from the `sm` breakpoint up. Nothing here depends on
 * JS-measured viewport width, so it renders correctly on the server and
 * needs no client-side hydration step to reach its final layout.
 */
export function StepIndicator({ steps, currentStepIndex, className }: StepIndicatorProps) {
  return (
    <ol
      aria-label="Guest essay flow progress"
      className={cn(
        'flex w-full items-start justify-between gap-1 sm:gap-2',
        className,
      )}
    >
      {steps.map((step, index) => {
        const isComplete = index < currentStepIndex;
        const isCurrent = index === currentStepIndex;

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-2"
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium sm:h-7 sm:w-7',
                isComplete && 'bg-primary text-primary-foreground',
                isCurrent && !isComplete && 'bg-primary/15 text-primary ring-2 ring-primary',
                !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
              )}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                'hidden truncate text-xs font-medium sm:inline sm:text-sm',
                isCurrent ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
