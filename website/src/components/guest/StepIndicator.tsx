import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  GUEST_FLOW_STEPS,
  type CanonicalGuestFlowStep,
  type GuestFlowStep,
  type GuestFlowStepId,
} from './flow-steps';

export type { GuestFlowStep, GuestFlowStepId };

/**
 * The canonical flow's ids only (KAN-9) — used below to decide whether a
 * step's label comes from the `chrome.guest.steps` catalogue or from the
 * literal string the caller supplied. Only the five canonical ids are
 * localised: a caller-supplied custom step list (the KAN-27 generic escape
 * hatch — see CUSTOM_STEPS in the tests) is not part of this story's guest
 * flow and keeps carrying its own literal `label` text, in whatever language
 * its author chose, same as before this story.
 */
const CANONICAL_STEP_IDS = new Set<string>(GUEST_FLOW_STEPS.map((s) => s.id));

/**
 * Generic over the supplied step list (KAN-27), defaulting to
 * CanonicalGuestFlowStep so a caller that doesn't pass its own `steps` keeps
 * exactly today's `GuestFlowStepId | 'none'` narrowing.
 *
 * Before this, `steps` was typed `readonly GuestFlowStep[]` (id: plain
 * string) while `currentStepId` was independently typed against the
 * canonical list, so the two props could disagree with no type error:
 *
 *   const CUSTOM = [{ id: 'alpha', label: 'Alpha' }] as const;
 *   <StepIndicator steps={CUSTOM} currentStepId="prompt" />
 *
 * `currentStepId="prompt"` compiled because it's a valid canonical id, but
 * `findIndex` against CUSTOM never finds it, so nothing highlights. Typing
 * `currentStepId` as `TStep['id']` instead — TStep inferred from the actual
 * `steps` argument — makes that a compile error. This only catches it when
 * the caller's `steps` list keeps its literal id types (e.g. `as const`, as
 * GUEST_FLOW_STEPS itself does); a plain mutable array widens `id` to
 * `string` and the generic can't recover what TypeScript already discarded.
 * The runtime warning below covers that remaining gap.
 *
 * "Keeps its literal id types" is narrower than "derived with `as const`",
 * and that gap is not caught by anything here:
 *
 *   <StepIndicator steps={GUEST_FLOW_STEPS.slice(0, 3)} currentStepId="register" />
 *
 * compiles and highlights nothing, because `.slice` on the const array's
 * type still returns a union of the FULL element type, `register` included
 * — TypeScript has no way to know the slice dropped it. By contrast
 *
 *   <StepIndicator steps={GUEST_FLOW_STEPS.filter((s) => s.id !== 'register')} currentStepId="register" />
 *
 * IS a compile error, because a `.filter` callback of that shape is inferred
 * as a type predicate excluding 'register', so `TStep['id']` narrows
 * correctly. Slicing a subset of the canonical list and expecting the
 * excluded ids to be rejected does not work; filtering with a matching type
 * guard does. Neither the runtime warning below helps here, since
 * `currentStepId` genuinely doesn't match any id in the sliced list — that
 * is exactly the "no step highlights" case it's meant to catch, and does,
 * just silently in production without a dev warning being the only signal
 * something is wrong (see the caveat above for why the warning itself is
 * dev-only).
 *
 * `steps={[]}` is also worth calling out: TStep then infers as `never` (no
 * element to infer a type from), so `currentStepId` collapses to `'none'`
 * alone — passing a real step id to a `steps={[]}` call is a compile error,
 * which was not true before this generic (currentStepId was independently
 * typed against the canonical list regardless of `steps`). See
 * StepIndicator.typecheck.tsx for the compiling/non-compiling pair.
 */
export interface StepIndicatorProps<TStep extends GuestFlowStep = CanonicalGuestFlowStep> {
  /** Defaults to GUEST_FLOW_STEPS. Pass [] on screens with no progress bar. */
  steps?: readonly TStep[];
  /**
   * Id of the step currently in progress, or 'none' before the flow starts.
   *
   * Deliberately an id rather than an index. Positional indices meant every
   * shipped screen hardcoded an integer, so reordering the flow — collapsing
   * 'submit' into 'write', say, or inserting a 'grading' step — silently
   * mis-highlighted every existing page with no type error and no failing
   * test. An unknown id is a compile error instead (see TStep above for the
   * caveat on non-const step lists).
   */
  currentStepId: TStep['id'] | 'none';
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
export function StepIndicator<TStep extends GuestFlowStep = CanonicalGuestFlowStep>({
  steps,
  currentStepId,
  className,
}: StepIndicatorProps<TStep>) {
  const t = useTranslations('chrome.guest');
  // Cast, not a default parameter value: GUEST_FLOW_STEPS is typed as
  // readonly CanonicalGuestFlowStep[], which isn't assignable to
  // readonly TStep[] for an arbitrary caller-supplied TStep. Safe because
  // this branch only runs when `steps` was omitted, i.e. the caller is
  // relying on the default TStep = CanonicalGuestFlowStep.
  const resolvedSteps = steps ?? (GUEST_FLOW_STEPS as unknown as readonly TStep[]);
  if (resolvedSteps.length === 0) return null;

  const currentStepIndex =
    currentStepId === 'none' ? -1 : resolvedSteps.findIndex((s) => s.id === currentStepId);

  // Fallback for the case the generic TStep can't catch: a `steps` list
  // whose `id` literals were widened to plain `string` (no `as const`), so
  // TStep infers as `GuestFlowStep` and a mismatched currentStepId compiles.
  // Runtime-only and dev-mode-only — this can't replace the type check
  // above, only extend its coverage to non-const callers.
  if (
    process.env.NODE_ENV !== 'production' &&
    currentStepId !== 'none' &&
    currentStepIndex === -1
  ) {
    console.warn(
      `StepIndicator: currentStepId "${String(currentStepId)}" does not match any id in the supplied steps list — no step will render as current.`,
    );
  }

  return (
    <ol
      aria-label={t('progressLabel')}
      className={cn(
        'flex w-full items-start justify-between gap-1 sm:gap-2',
        className,
      )}
    >
      {resolvedSteps.map((step, index) => {
        const isComplete = currentStepIndex >= 0 && index < currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const label = CANONICAL_STEP_IDS.has(step.id) ? t(`steps.${step.id}`) : step.label;

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            // No suffix for the current step: aria-current="step" already
            // announces it, and repeating it double-announces. ", completed"
            // has no ARIA equivalent and is what conveys the check icon in
            // text — the `completed` param below picks that ICU `select`
            // case (see chrome.guest.stepAriaLabel in the message catalogue)
            // rather than string-concatenating a translated suffix onto an
            // untranslated template, which would produce the wrong word
            // order in German.
            aria-label={t('stepAriaLabel', {
              index: index + 1,
              total: resolvedSteps.length,
              label,
              completed: isComplete ? 'yes' : 'no',
            })}
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
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
