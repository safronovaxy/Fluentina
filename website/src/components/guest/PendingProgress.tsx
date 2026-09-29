'use client';

/**
 * KAN-17 (BR-5.3) — what the guest sees while grading is unfinished, beyond
 * "please wait". Every element below is backed by something the poll
 * response really says; nothing here is a guess or an animation:
 *
 *  - Stage: the job's own `status`. `pending` = written down and waiting for
 *    a worker to pick it up; `processing` = a worker has claimed it (the
 *    atomic claim in `markGradingJobProcessingUnscoped`, immediately before
 *    the provider call). Worded as what the STATE is, not as a promise about
 *    the provider: a claimed job whose instance died stays `processing`
 *    (KAN-38), so "being graded" is deliberately "has been picked up".
 *  - Elapsed time: the job's age on the server's clock at the last answer
 *    (`GradingStatus.jobAgeMs`, from `createdAt`), carried forward by the
 *    client clock's DIFFERENCE between then and now — so a wrong system
 *    clock cannot skew it. Shown as m:ss and kept monotonic: a new answer
 *    can land up to a second behind the extrapolation (the `Date` header
 *    has whole-second resolution) and a clock that steps back would read as
 *    a bug.
 *  - After `GRADING_SLOW_AFTER_MS`: a plain statement that this is past the
 *    target, that nothing has failed as far as the status shows, and how
 *    long the page will keep checking (the poll bound — a real constant).
 *
 * Deliberately NOT here: a percentage or progress bar (no signal says how
 * far along a provider call is), and a step tracker. `processing` can
 * revert to `pending` when a provider call fails and is retried
 * (`revertGradingJobToPendingUnscoped`), so a tracker would imply a
 * monotonic progression the state does not have. A spinner is omitted too:
 * it says only "the page is alive", which the running clock already does.
 *
 * Accessibility: nothing in here is a live region. The clock changes every
 * second, and a polite region that re-announced it would turn the screen
 * reader into a stream. The one announcement this state produces — "taking
 * longer than we aim for", once, when it begins — is made by
 * `GradingPreview`'s single persistent announcer, not here, so a state
 * change is still announced exactly once.
 */
import { useEffect, useRef, useState } from 'react';
import type { GradingJobStatus } from '@/lib/contracts/grading-job';

export interface PendingProgressStrings {
  readonly stageLabel: string;
  readonly stageQueued: string;
  readonly stageProcessing: string;
  readonly elapsedLabel: string;
  readonly slowNotice: string;
  readonly slowKeepChecking: string;
}

export interface PendingProgressProps {
  /** The job's status at the last answer — `undefined` before the first one, when nothing true can be said yet. */
  readonly status: GradingJobStatus | undefined;
  /** The job's age (server clock) when that answer arrived — see `GradingStatus.jobAgeMs`. */
  readonly jobAgeMs: number | null;
  /** Client-clock time (ms since epoch) that answer arrived — `query.dataUpdatedAt`. Only ever differenced against now. */
  readonly answeredAt: number;
  readonly slow: boolean;
  readonly strings: PendingProgressStrings;
}

function formatElapsed(ms: number): { readonly text: string; readonly iso: string } {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return { text: `${minutes}:${String(seconds).padStart(2, '0')}`, iso: `PT${minutes}M${seconds}S` };
}

export function PendingProgress({ status, jobAgeMs, answeredAt, slow, strings }: PendingProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Nothing is known about the job until the first answer arrives.
  if (!status || jobAgeMs === null) return null;

  const extrapolated = jobAgeMs + Math.max(0, now - answeredAt);
  shown.current = Math.max(shown.current, extrapolated);
  const elapsed = formatElapsed(shown.current);

  return (
    <div className="mt-4 space-y-3 text-sm" data-testid="pending-progress">
      {slow && (
        <div data-testid="slow-notice" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-medium">{strings.slowNotice}</p>
          <p className="text-muted-foreground">{strings.slowKeepChecking}</p>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{strings.stageLabel}</dt>
        <dd className="font-medium" data-testid="grading-stage" data-stage={status}>
          {status === 'processing' ? strings.stageProcessing : strings.stageQueued}
        </dd>
        <dt className="text-muted-foreground">{strings.elapsedLabel}</dt>
        <dd className="font-medium tabular-nums" data-testid="grading-elapsed">
          <time dateTime={elapsed.iso}>{elapsed.text}</time>
        </dd>
      </dl>
    </div>
  );
}
