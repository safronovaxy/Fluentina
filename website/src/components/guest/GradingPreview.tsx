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
 * KAN-19 (BR-4.2): what this screen can show is decided by the SERVER, per
 * caller, and arrives as `report` (`lib/contracts/grading-report.ts`). A guest
 * is sent a `locked` report — score, band, one worked example, and how many
 * marked passages exist and where — and is never sent the summary, dimension
 * scores/comments or the other annotations, so nothing here is hiding them.
 * That is why this component takes no essay text and does no picking: the
 * worked example's sentence arrives already cut. The locked panel below states
 * what the guest is not seeing; it is copy about the lock, not a lock.
 *
 * Scope boundary: the waiting state, the moment grading finishes, and the
 * locked teaser. Rendering a `full` report (a registered owner's summary,
 * dimension comments and every annotation) is not built here — a `full`
 * answer shows the same score and example, minus the locked panel.
 *
 * Six states, one per `phase` below:
 *  - pending   — job not finished (or first poll not back yet). KAN-17
 *                (BR-5.3) adds what is really known while it waits — the
 *                job's stage and its age — see `PendingProgress`, and a
 *                "taking longer than we aim for" notice once the job is
 *                past `GRADING_SLOW_AFTER_MS`. That notice is NOT a phase of
 *                its own: a new phase would remount the heading and move the
 *                guest's focus in the middle of a wait. It is the same
 *                phase, same heading, with more said under it.
 *  - complete  — score, band, worked example, and (locked) the locked panel.
 *  - flagged   — the report is `withheld`: the result was flagged for review.
 *                See `resolvePhase`.
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
 *    `role="alert"`/`aria-live`, so a state change is announced once. While
 *    pending it stays empty except for ONE message, when the job first
 *    passes the slow mark: the clock and the stage in `PendingProgress`
 *    change every second or on a retry and are deliberately not announced —
 *    a region that re-read them would make the page unusable with a screen
 *    reader.
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
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { usePendingElapsed } from '@/hooks/use-pending-elapsed';
import { useGradingStatus, isSlow, isStalled, GradingStatusError, type GradingStatus } from '@/hooks/use-grading-status';
import { RUBRIC_DIMENSIONS, type GradingFailureReason, type RubricDimension } from '@/lib/contracts/grading';
import type { GradingReportView } from '@/lib/contracts/grading-report';
import { PendingProgress, type PendingProgressStrings } from './PendingProgress';

type VisibleReport = Exclude<GradingReportView, { access: 'withheld' }>;

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

export interface GradingPreviewStrings extends PendingProgressStrings {
  readonly pendingTitle: string;
  readonly pendingBody: string;
  /** Read out once, when a still-unfinished job first passes the slow mark — e.g. "Still grading. This is taking longer than the minute we aim for." */
  readonly slowAnnouncement: string;
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
  readonly lockedTitle: string;
  /** Carries `{shown}` and `{total}` placeholders, e.g. "{shown} of {total} marked passages shown". */
  readonly lockedCount: string;
  /** Shown instead of `lockedCount` when the essay has no marked passages at all. */
  readonly lockedCountNone: string;
  readonly lockedByDimensionLabel: string;
  readonly dimensions: Readonly<Record<RubricDimension, string>>;
  readonly lockedIncludesLabel: string;
  readonly lockedItemSummary: string;
  readonly lockedItemDimensions: string;
  readonly lockedItemAnnotations: string;
  // PROVISIONAL COPY. The wording of `lockedNote` (and the other `locked*`
  // catalogue keys) is unreviewed: BR-4.2 specifies WHAT is locked, not what
  // the panel says. It names an account; the way to get one is
  // `registerAction`, below.
  readonly lockedNote: string;
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
  readonly strings: GradingPreviewStrings;
  /** A pre-rendered, locale-aware link back to essay entry — shown where the guest has no result to look at. */
  readonly tryAgainAction: ReactNode;
  /**
   * KAN-55 — the locked panel's call to action: a pre-rendered, locale-aware
   * link to registration that carries this essay's id, so the guest comes back
   * to this report once they have an account. Pre-rendered for the same reason
   * `tryAgainAction` is (this component cannot reach `next-intl` or the
   * locale-aware `Link`). Rendered ONLY in the locked panel — a `full` report
   * has nothing left to unlock, so it never shows.
   */
  readonly registerAction: ReactNode;
}

type Phase = 'pending' | 'complete' | 'flagged' | 'failed' | 'stalled' | 'pollError';

/**
 * `flagged` is a `withheld` report (KAN-19). When
 * `clampForSuspectedInjection` (lib/domain/grading/result.ts) trips it caps
 * the score at 55 and REPLACES the summary and all four dimension comments
 * with fixed operator-facing English placeholders ("Comment withheld — see
 * the flagged-for-review summary."). Those are not feedback about the
 * guest's essay, and the capped numbers are not an assessment of it — the
 * result's own summary calls them "not a reliable assessment". So nothing
 * from a flagged result is shown: no score, no band, no comments, and no
 * annotation either, since the model that produced them was reading an essay
 * the guard distrusts. The clamp does NOT touch `annotations`, so until
 * KAN-19 the distrusted model's annotation text was serialised to the browser
 * and only this component kept it off screen; now the server sends a
 * `withheld` report that carries the flag and nothing else, and there is no
 * text here to suppress. An honest B2 essay can land here (KAN-40 false positives), which is why
 * the copy says the check can be wrong. It names the SHAPE that trips the
 * check ("an instruction about how to grade it") and never a location:
 * `detectPromptInjection` returns no span, and surfacing one would hand an
 * attacker a filter-bypass oracle. Every resubmission spends one of five per
 * hour, so the copy must not send the guest hunting blindly either.
 */
function resolvePhase(status: GradingStatus | undefined, pollFailed: boolean): Phase {
  if (status?.status === 'succeeded' && status.report) return status.report.access === 'withheld' ? 'flagged' : 'complete';
  if (status?.status === 'failed') return 'failed';
  if (isStalled(status)) return 'stalled';
  // Reached after the query's own retries are spent (see the hook), at which
  // point polling has stopped — showing `pending` on would be a screen that
  // never changes again. Say so, and offer a manual retry.
  if (pollFailed) return 'pollError';
  return 'pending';
}

function bandText(overallBand: string, strings: GradingPreviewStrings): string {
  const key = (BAND_STRING_KEYS as Record<string, BandStringKey | undefined>)[overallBand];
  // A label this UI has no translation for: show it untranslated rather than
  // nothing — the score is still true.
  return key ? strings.bands[key] : overallBand;
}

/** The score and band both report shapes that can be shown carry — `full` nests them under `result`. */
function scoreOf(report: VisibleReport): { overallScore: number; overallBand: string } {
  return report.access === 'full' ? report.result : report;
}

/**
 * What the guest is NOT being shown, and how much of it there is. Every
 * number comes from the `locked` report; the lists of what the full report
 * holds are catalogue copy, not data — they are the same for every essay, so
 * the server sends no flag for them. The dimension counts include zeros:
 * "nothing marked under vocabulary" is itself information, and the server
 * sends all four keys always.
 */
function LockedPanel({
  report,
  shown,
  strings,
  registerAction,
}: {
  report: Extract<VisibleReport, { access: 'locked' }>;
  shown: number;
  strings: GradingPreviewStrings;
  registerAction: ReactNode;
}) {
  const headingId = useId();
  const count =
    report.annotationCount === 0
      ? strings.lockedCountNone
      : strings.lockedCount.replace('{shown}', String(shown)).replace('{total}', String(report.annotationCount));

  return (
    <div className="mt-6 border-t pt-4" data-testid="locked-report" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="font-semibold">
        {strings.lockedTitle}
      </h3>
      <p className="mt-1 text-sm" data-testid="locked-count">
        {count}
      </p>

      {report.annotationCount > 0 && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">{strings.lockedByDimensionLabel}</p>
          <dl className="mt-1 space-y-1 text-sm" data-testid="locked-dimension-counts">
            {RUBRIC_DIMENSIONS.map((dimension) => (
              <div key={dimension} className="flex justify-between gap-4">
                <dt>{strings.dimensions[dimension]}</dt>
                <dd className="tabular-nums" data-testid={`locked-count-${dimension}`}>
                  {report.annotationCountByDimension[dimension]}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <p className="mt-4 text-sm text-muted-foreground">{strings.lockedIncludesLabel}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-testid="locked-includes">
        <li>{strings.lockedItemSummary}</li>
        <li>{strings.lockedItemDimensions}</li>
        <li>{strings.lockedItemAnnotations}</li>
      </ul>
      <p className="mt-3 text-sm font-medium">{strings.lockedNote}</p>
      {/* The funnel: the one place a guest looking at this panel can act on it. */}
      <div className="mt-3" data-testid="locked-register-cta">
        {registerAction}
      </div>
    </div>
  );
}

export function GradingPreview({ essayId, strings, tryAgainAction, registerAction }: GradingPreviewProps) {
  const query = useGradingStatus(essayId);
  const status = query.data;
  const phase = resolvePhase(status, query.isError);
  // ONE monotonic age drives both the clock on screen and the slow state (and
  // so the announcement): the raw age from a poll can step back between
  // answers, and a `slow` derived from it would empty the announcer and refill
  // it — a second read-out. Only ticks while a job is unfinished.
  const elapsedMs = usePendingElapsed(essayId, phase === 'pending' ? status?.jobAgeMs ?? null : null, query.dataUpdatedAt);
  const slow = phase === 'pending' && isSlow(status, elapsedMs);

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

  const report = phase === 'complete' && status?.report && status.report.access !== 'withheld' ? status.report : null;
  const score = report ? scoreOf(report) : null;
  const example = report?.workedExample ?? null;

  const notFound = query.error instanceof GradingStatusError && query.error.reason === 'gradingJobNotFound';

  const announcement = (() => {
    switch (phase) {
      case 'complete':
        return score
          ? `${strings.completeAnnouncement} ${score.overallScore} ${strings.scoreOutOf}, ${bandText(score.overallBand, strings)}.`
          : '';
      case 'flagged':
        return strings.flaggedTitle;
      case 'failed':
        return strings.failedTitle;
      case 'stalled':
        return strings.stalledTitle;
      case 'pollError':
        return strings.pollErrorTitle;
      // Nothing for `pending` until it runs slow: the guest was just moved
      // to this screen with the waiting heading focused, which already says
      // it. The slow message is announced once, when it appears — it does
      // not change again, so it is not re-read on later polls or ticks.
      case 'pending':
        return slow ? strings.slowAnnouncement : '';
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
            <PendingProgress status={status?.status} elapsedMs={elapsedMs} slow={slow} strings={strings} />
          </>
        )}

        {phase === 'complete' && report && score && (
          <>
            {heading(strings.completeTitle)}
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums" data-testid="overall-score">
                {score.overallScore}
              </span>
              <span className="text-muted-foreground">{strings.scoreOutOf}</span>
            </p>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{strings.bandLabel}: </span>
              <span className="font-medium" data-testid="overall-band">
                {bandText(score.overallBand, strings)}
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
                      {example.message}
                    </p>
                    {example.suggestion && (
                      <p>
                        <span className="font-medium">{strings.suggestionLabel}: </span>
                        {example.suggestion}
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

            {report.access === 'locked' && (
              <LockedPanel report={report} shown={example ? 1 : 0} strings={strings} registerAction={registerAction} />
            )}
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
