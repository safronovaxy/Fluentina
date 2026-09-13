import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GUEST_FLOW_STEPS, type GuestFlowStep, type GuestFlowStepId } from './flow-steps';

export type { GuestFlowStep, GuestFlowStepId };

export interface StepIndicatorProps {
  steps?: readonly GuestFlowStep[];
  /**
   * Id of the step currently in progress, or 'none' before the flow starts.
   *
   * Deliberately an id rather than an index. Positional indices meant every
   * shipped screen hardcoded an integer, so reordering the flow — collapsing
   * 'submit' into 'write', say, or inserting a 'grading' step — silently
   * mis-highlighted every existing page with no type error and no failing
   * test. An unknown id is a compile error instead.
   */
  currentStepId: GuestFlowStepId | 'none';
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
 * shown alongside it from the `md` breakpoint up. Nothing here depends on
 * JS-measured viewport width, so it renders correctly on the server and
 * needs no client-side hydration step to reach its final layout.
 *
 * Accessibility note: the visual label is CSS-hidden on narrow screens, so
 * each item also carries an explicit aria-label. `hidden` is display:none,
 * which removes the node from the accessibility tree entirely — a completed
 * step would otherwise announce as an empty list item, because its only
 * remaining content is an aria-hidden check icon. Completion is conveyed in
 * text there too, not by icon and colour alone.
 */
export function StepIndicator({
  steps = GUEST_FLOW_STEPS,
  currentStepId,
  className,
}: StepIndicatorProps) {
  if (steps.length === 0) return null;

  const currentStepIndex =
    currentStepId === 'none' ? -1 : steps.findIndex((s) => s.id === currentStepId);

  return (
    <ol
      aria-label="Guest essay flow progress"
      className={cn(
        'flex w-full items-start justify-between gap-1 sm:gap-2',
        className,
      )}
    >
      {steps.map((step, index) => {
        const isComplete = currentStepIndex >= 0 && index < currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const state = isComplete ? ', completed' : isCurrent ? ', current step' : '';

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`Step ${index + 1} of ${steps.length}: ${step.label}${state}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 md:flex-row md:items-center md:gap-2"
          >
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium sm:h-7 sm:w-7',
                isComplete && 'bg-primary text-primary-foreground',
                isCurrent && !isComplete && 'bg-primary/15 text-primary ring-2 ring-primary',
                !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
              )}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              aria-hidden
              className={cn(
                // Revealed at `md`, not `sm`: between roughly 640 and 720px
                // five labels share the row with the wordmark and truncate to
                // fragments like "Choose pro…".
                'hidden truncate text-xs font-medium md:inline md:text-sm',
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
