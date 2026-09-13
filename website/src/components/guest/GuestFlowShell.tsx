import Link from 'next/link';
import { ArrowLeft, PenTool } from 'lucide-react';
import { StepIndicator } from './StepIndicator';
import { type CanonicalGuestFlowStep, type GuestFlowStep } from './flow-steps';
import { cn } from '@/lib/utils';

/** The shell's own default content width, shared by the header and main. */
const DEFAULT_CONTENT_WIDTH_CLASS = 'max-w-3xl';

/**
 * Resolves the winning `max-w-*` utility once contentClassName is merged in,
 * so the header can track the same width as `main` (KAN-27) without also
 * inheriting unrelated overrides — a page passing `px-0` for its content
 * gutter shouldn't also strip the header's own padding.
 *
 * Only the max-w-* tokens from contentClassName are considered; tailwind-
 * merge then resolves them against the default the same way `cn` already
 * does for `main`, so a conflicting width still replaces rather than stacks
 * (pinned by the existing contentClassName test).
 */
function resolveContentWidthClassName(contentClassName?: string): string {
  const widthOverrides = contentClassName
    ?.split(/\s+/)
    .filter((token) => token.startsWith('max-w-'))
    .join(' ');
  return cn(DEFAULT_CONTENT_WIDTH_CLASS, widthOverrides);
}

export interface GuestFlowShellProps<TStep extends GuestFlowStep = CanonicalGuestFlowStep> {
  children: React.ReactNode;
  /** Defaults to GUEST_FLOW_STEPS. Pass [] on screens with no progress bar. */
  steps?: readonly TStep[];
  /** Step id, or 'none' before the flow starts. See StepIndicator. */
  currentStepId: TStep['id'] | 'none';
  /**
   * Extra classes for the content wrapper — most pages won't need this.
   *
   * Merged with tailwind-merge, so a conflicting utility REPLACES the
   * default rather than stacking: passing `max-w-5xl` drops `max-w-3xl`,
   * and `px-0` drops the `px-4` gutter. That is intended, and pinned by a
   * test, so the next story finds out at test time rather than in review.
   *
   * A `max-w-*` override here also carries over to the header container
   * (KAN-27), so the two stay visually aligned; other utilities (padding,
   * etc.) apply to the content column only.
   */
  contentClassName?: string;
  /**
   * Href for an optional back link, rendered in the header before the step
   * indicator (KAN-27). Omit on screens with nothing to go back to, e.g. the
   * landing page — the header renders exactly as before, with no reserved
   * space and no layout shift.
   */
  backHref?: string;
  /** Accessible name and (from `sm` up) visible label for the back link. Defaults to "Back". */
  backLabel?: string;
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
 *
 * `backHref`/`backLabel` (KAN-27) is a `backHref` + `backLabel` pair rather
 * than an open `headerSlot` node: the only concrete driver is prompt
 * selection (KAN-13) needing a way back to essay entry (KAN-14) and vice
 * versa, and a typed pair keeps every screen's back link visually and
 * semantically consistent instead of each story hand-rolling its own. If a
 * second, unrelated header affordance shows up later, that is the point to
 * revisit a general slot — not before there is a second real use.
 */
export function GuestFlowShell<TStep extends GuestFlowStep = CanonicalGuestFlowStep>({
  children,
  steps,
  currentStepId,
  contentClassName,
  backHref,
  backLabel,
}: GuestFlowShellProps<TStep>) {
  const contentWidthClassName = resolveContentWidthClassName(contentClassName);

  return (
    // min-h-dvh, not min-h-screen: 100vh on iOS Safari and Chrome Android is
    // the *large* viewport height, which ignores the visible URL bar, so a
    // short page scrolls for no reason and a bottom-anchored control would
    // sit under the browser chrome.
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card">
        <div
          className={cn(
            'mx-auto flex items-center gap-4 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4',
            contentWidthClassName,
          )}
        >
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 font-semibold text-foreground"
            aria-label="Fluentina home"
          >
            <PenTool className="h-5 w-5 text-primary" aria-hidden />
            <span className="hidden sm:inline">Fluentina</span>
          </Link>
          {backHref && (
            <Link
              href={backHref}
              className="flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              aria-label={backLabel ?? 'Back'}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{backLabel ?? 'Back'}</span>
            </Link>
          )}
          <StepIndicator steps={steps} currentStepId={currentStepId} />
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-10',
          contentWidthClassName,
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
