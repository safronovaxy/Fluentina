'use client';

/**
 * KAN-18 (BR-4.1) — the guest's first sight of their grade: overall score
 * and band, plus one fully worked example (a real sentence from their own
 * essay, the error highlighted and explained), shown as soon as the grading
 * job finishes.
 *
 * Same convention as `EssayEntryForm`, for the same reason: not under
 * `chrome/`, so it cannot import `next-intl` (see eslint.config.js) — every
 * catalogue string arrives translated as `strings` from the Server Component
 * page, and the one action that needs a locale-aware link (`tryAgainAction`)
 * arrives as an already-rendered node. Grading OUTPUT (the annotation's
 * message and suggestion, the guest's own sentence) is data from the
 * provider and the essay and is rendered as-is, never routed through the
 * catalogue.
 *
 * Scope boundary: the minimum waiting state "the moment grading finishes"
 * needs, and nothing more. A progress experience is KAN-5; the locked full
 * report (dimension scores and comments, the summary, every annotation) is
 * KAN-6. This deliberately renders none of `summary`, `dimensions` or any
 * annotation past the one example.
 *
 * Six states, one per `phase` below:
 *  - pending   — job not finished (or first poll not back yet).
 *  - complete  — score, band, worked example.
 *  - flagged   — the result carries `flaggedForReview`. See `resolvePhase`.
 *  - failed    — the JOB failed; no score exists, and none is invented.
 *  - stalled   — the job is STILL unfinished after `GRADING_POLL_MAX_AGE_MS`
 *                and polling has stopped: pending is the one phase with no
 *                way out, so a job that was never enqueued must not sit
 *                there forever. Not `failed` — nothing failed, we just
 *                stopped waiting, and saying otherwise would be a claim.
 *  - pollError — the status request itself failed; grading may be fine.
 *
 * Accessibility (a result arriving after a poll is a live region):
 *  - One persistent `role="status"` node, present from first render (a live
 *    region only announces changes made to a node that already exists), is
 *    the only announcer. It carries a short terminal-state message — not the
 *    whole result — and is visually hidden. Nothing else here uses
 *    `role="alert"`/`aria-live`, so a state change is announced once.
 *  - Focus follows the content. Each phase has its own `tabIndex={-1}`
 *    heading; when the phase changes, focus moves to the new one if it would
 *    otherwise be lost (the old heading, or a button in the old panel, just
 *    unmounted) — but NOT if the guest has since moved focus somewhere
 *    deliberate (the language switcher, say).
 *  - The highlighted span is a `<mark>` whose meaning does not depend on
 *    colour: a wavy underline, visually hidden start/end markers inside it,
 *    and `aria-describedby`/`aria-details` pointing at the explanation, so
 *    the explanation belongs to the span rather than sitting next to it.
 */
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useGradingStatus, isStalled, GradingStatusError, type GradingStatus } from '@/hooks/use-grading-status';
import { bandForScore, type GradingFailureReason, type GradingResult } from '@/lib/contracts/grading';
import { pickWorkedExample } from './worked-example';

/**
 * `bandForScore` (lib/contracts/grading.ts) returns English labels, and a
 * label is not a translation key. Keyed by its exact outputs so a guest in
 * German is not shown an English band; `GradingPreview.test.tsx` sweeps every
 * score 0-100 through `bandForScore` and fails if a label it can return is
 * missing here, so changing a label there cannot silently fall through to
 * the untranslated fallback below.
 */
export const BAND_STRING_KEYS = {
  'B2+ (strong pass)': 'strongPass',
  'B2 (pass)': 'pass',
  'B2- (borderline)': 'borderline',
  'B1 (below target)': 'belowTarget',
  'Below B1': 'belowB1',
} as const;

type BandStringKey = (typeof BAND_STRING_KEYS)[keyof typeof BAND_STRING_KEYS];

export interface GradingPreviewStrings {
  readonly pendingTitle: string;
  readonly pendingBody: string;
  readonly completeTitle: string;
  /** Read out, followed by the score, `scoreOutOf` and the band — e.g. "Grading finished. Your overall score is". */
  readonly completeAnnouncement: string;
  /** Follows the number, on screen and in the announcement — e.g. "out of 100". */
  readonly scoreOutOf: string;
  readonly bandLabel: string;
  readonly bands: Readonly<Record<BandStringKey, string>>;
  readonly exampleTitle: string;
  readonly exampleIntro: string;
  /** Visually hidden, read out immediately before / after the highlighted words. */
  readonly errorMarkerStart: string;
  readonly errorMarkerEnd: string;
  readonly explanationLabel: string;
  readonly suggestionLabel: string;
  readonly noExample: string;
  readonly flaggedTitle: string;
  readonly flaggedBody: string;
  readonly stalledTitle: string;
  readonly stalledBody: string;
  readonly failedTitle: string;
  readonly failedBody: string;
  readonly failedReasons: Readonly<Record<GradingFailureReason, string>>;
  readonly pollErrorTitle: string;
  readonly pollErrorBody: string;
  readonly pollErrorNotFoundBody: string;
  readonly retryCta: string;
}

export interface GradingPreviewProps {
  readonly essayId: string;
  /** The stored essay text the annotation offsets index into — read server-side, ownership-scoped. */
  readonly essayContent: string;
  readonly strings: GradingPreviewStrings;
  /** A pre-rendered, locale-aware link back to essay entry — shown where the guest has no result to look at. */
  readonly tryAgainAction: ReactNode;
}

type Phase = 'pending' | 'complete' | 'flagged' | 'failed' | 'stalled' | 'pollError';

/**
 * `flagged` is decided before `complete` on purpose. When
 * `clampForSuspectedInjection` (lib/domain/grading/result.ts) trips it caps
 * the score at 55 and REPLACES the summary and all four dimension comments
 * with fixed operator-facing English placeholders ("Comment withheld — see
 * the flagged-for-review summary."). Those are not feedback about the
 * guest's essay, and the capped numbers are not an assessment of it — the
 * result's own summary calls them "not a reliable assessment". So nothing
 * from a flagged result is rendered at all: no score, no band, no comments,
 * and no annotation either, since the model that produced them was reading
 * an essay the guard distrusts. (The clamp does NOT touch `annotations` —
 * a flagged result still carries the distrusted model's annotation text, so
 * "nothing renders it" is this component's job, pinned by an allow-list test.)
 * An honest B2 essay can land here (KAN-40 false positives), which is why
 * the copy says the check can be wrong. It names the SHAPE that trips the
 * check ("an instruction about how to grade it") and never a location:
 * `detectPromptInjection` returns no span, and surfacing one would hand an
 * attacker a filter-bypass oracle. Every resubmission spends one of five per
 * hour, so the copy must not send the guest hunting blindly either.
 */
function resolvePhase(status: GradingStatus | undefined, pollFailed: boolean): Phase {
  if (status?.status === 'succeeded' && status.result) return status.result.flaggedForReview ? 'flagged' : 'complete';
  if (status?.status === 'failed') return 'failed';
  if (isStalled(status)) return 'stalled';
  // Reached after the query's own retries are spent (see the hook), at which
  // point polling has stopped — showing `pending` on would be a screen that
  // never changes again. Say so, and offer a manual retry.
  if (pollFailed) return 'pollError';
  return 'pending';
}

function bandText(result: GradingResult, strings: GradingPreviewStrings): string {
  const key = (BAND_STRING_KEYS as Record<string, BandStringKey | undefined>)[result.overallBand];
  // A label this UI has no translation for: show it untranslated rather than
  // nothing — the score is still true.
  return key ? strings.bands[key] : result.overallBand;
}

export function GradingPreview({ essayId, essayContent, strings, tryAgainAction }: GradingPreviewProps) {
  const query = useGradingStatus(essayId);
  const status = query.data;
  const phase = resolvePhase(status, query.isError);

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPhase = useRef<Phase | null>(null);
  const headingId = useId();
  const explanationId = useId();

  // Focus. Runs on mount (arriving from the submit) and on every phase
  // change; see the file comment for the "only if it would be lost" rule.
  useEffect(() => {
    const first = previousPhase.current === null;
    previousPhase.current = phase;
    const active = document.activeElement;
    const focusWouldBeLost = !active || active === document.body || panelRef.current?.contains(active);
    if (first || focusWouldBeLost) headingRef.current?.focus();
  }, [phase]);

  const result = phase === 'complete' ? status?.result ?? null : null;
  const example = useMemo(
    () => (result ? pickWorkedExample(essayContent, result.annotations) : null),
    [result, essayContent],
  );

  const notFound = query.error instanceof GradingStatusError && query.error.reason === 'gradingJobNotFound';

  const announcement = (() => {
    switch (phase) {
      case 'complete':
        return result
          ? `${strings.completeAnnouncement} ${result.overallScore} ${strings.scoreOutOf}, ${bandText(result, strings)}.`
          : '';
      case 'flagged':
        return strings.flaggedTitle;
      case 'failed':
        return strings.failedTitle;
      case 'stalled':
        return strings.stalledTitle;
      case 'pollError':
        return strings.pollErrorTitle;
      // Nothing for `pending`: the guest was just moved to this screen with
      // the waiting heading focused, which already says it.
      case 'pending':
        return '';
    }
  })();

  const headingClass = 'text-lg font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  // Each phase renders this from its own conditional branch below, so React
  // mounts a fresh heading per phase and the old (focused) one really
  // unmounts — which is what gives the focus effect above something to
  // recover from and a new node to move to.
  const heading = (text: string) => (
    <h2 id={headingId} ref={headingRef} tabIndex={-1} className={headingClass}>
      {text}
    </h2>
  );

  return (
    <div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <section
        ref={panelRef}
        aria-labelledby={headingId}
        aria-busy={phase === 'pending'}
        className="rounded-lg border bg-card p-6"
        data-phase={phase}
      >
        {phase === 'pending' && (
          <>
            {heading(strings.pendingTitle)}
            <p className="mt-2 text-sm text-muted-foreground">{strings.pendingBody}</p>
          </>
        )}

        {phase === 'complete' && result && (
          <>
            {heading(strings.completeTitle)}
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums" data-testid="overall-score">
                {result.overallScore}
              </span>
              <span className="text-muted-foreground">{strings.scoreOutOf}</span>
            </p>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{strings.bandLabel}: </span>
              <span className="font-medium" data-testid="overall-band">
                {bandText(result, strings)}
              </span>
            </p>

            <div className="mt-6 border-t pt-4">
              <h3 className="font-semibold">{strings.exampleTitle}</h3>
              {example ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">{strings.exampleIntro}</p>
                  {/* The essay is German by definition (NFR §8), whatever the UI language — `lang` lets a screen reader pronounce it as such. */}
                  <blockquote lang="de" className="mt-3 border-l-4 pl-4 leading-relaxed" data-testid="worked-example-sentence">
                    {example.before}
                    <mark
                      aria-describedby={explanationId}
                      aria-details={explanationId}
                      className="rounded-sm bg-amber-200/70 px-0.5 text-foreground underline decoration-destructive decoration-wavy underline-offset-4 dark:bg-amber-500/30"
                      data-testid="worked-example-highlight"
                    >
                      <span className="sr-only">{strings.errorMarkerStart} </span>
                      {example.highlighted}
                      <span className="sr-only"> {strings.errorMarkerEnd}</span>
                    </mark>
                    {example.after}
                  </blockquote>
                  <div id={explanationId} className="mt-3 space-y-1 text-sm" data-testid="worked-example-explanation">
                    <p>
                      <span className="font-medium">{strings.explanationLabel}: </span>
                      {example.annotation.message}
                    </p>
                    {example.annotation.suggestion && (
                      <p>
                        <span className="font-medium">{strings.suggestionLabel}: </span>
                        {example.annotation.suggestion}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground" data-testid="worked-example-none">
                  {strings.noExample}
                </p>
              )}
            </div>
          </>
        )}

        {phase === 'flagged' && (
          <>
            {heading(strings.flaggedTitle)}
            <p className="mt-2 text-sm text-muted-foreground">{strings.flaggedBody}</p>
            <div className="mt-4">{tryAgainAction}</div>
          </>
        )}

        {phase === 'failed' && (
          <>
            {heading(strings.failedTitle)}
            <p className="mt-2 text-sm">
              {strings.failedReasons[status?.failureReason ?? 'unknown']}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{strings.failedBody}</p>
            <div className="mt-4">{tryAgainAction}</div>
          </>
        )}

        {phase === 'stalled' && (
          <>
            {heading(strings.stalledTitle)}
            <p className="mt-2 text-sm text-muted-foreground">{strings.stalledBody}</p>
            <div className="mt-4">{tryAgainAction}</div>
          </>
        )}

        {phase === 'pollError' && (
          <>
            {heading(strings.pollErrorTitle)}
            <p className="mt-2 text-sm text-muted-foreground">
              {notFound ? strings.pollErrorNotFoundBody : strings.pollErrorBody}
            </p>
            <div className="mt-4">
              {notFound ? (
                tryAgainAction
              ) : (
                <Button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
                  {strings.retryCta}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
