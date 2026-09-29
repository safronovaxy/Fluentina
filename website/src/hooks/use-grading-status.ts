'use client';

/**
 * KAN-18 — polls `GET /api/essays/[id]/grading` (KAN-16, ADR-2: "every 2-3
 * seconds until the job is ready") with TanStack Query's own
 * `refetchInterval`, not a hand-rolled timer, so the interval stops the
 * moment the job reaches a terminal state, pauses in a hidden tab, and is
 * torn down on unmount without any of that being this file's to get right.
 *
 * Only the fields the preview needs are read out of the response — see
 * `lib/contracts/grading-job.ts` for the full shape. `createdAt` arrives as
 * a JSON string and is read for one thing: bounding the poll (below).
 *
 * The finished grade arrives as `report` (KAN-19), already reduced by the
 * server to what this caller may see — `lib/contracts/grading-report.ts`. It
 * is PARSED, not cast: an `access` value this client does not know is a
 * malformed answer (`GradingStatusError(null)`), never a fall-through into a
 * blank render.
 *
 * The poll is bounded, and bounded on the JOB'S age (`createdAt`), not on a
 * timer started when this hook mounted, so a reload does not restart the
 * clock. A job stuck `pending`/`processing` is a documented, accepted
 * failure mode — `start-grading.ts` writes the row before enqueuing, and a
 * dropped Cloud Task is silently lost (ADR-19) — and without a bound the
 * guest would be told "this page updates by itself" forever, on the one
 * screen with no way out.
 *
 * Nothing about the job is logged: a `GradingResult` can carry annotation
 * text that quotes the guest's essay, and this is client code anyway — no
 * `console.*` here, ever.
 */
import { useQuery } from '@tanstack/react-query';
import { GRADING_JOB_STATUSES, type GradingJobStatus } from '@/lib/contracts/grading-job';
import { isGradingFailureReason, type GradingFailureReason } from '@/lib/contracts/grading';
import { gradingReportViewSchema, type GradingReportView } from '@/lib/contracts/grading-report';
import { isRejectionReason, type RejectionReason } from '@/lib/contracts/rejection-reason';

/** ADR-2 says 2-3 seconds; the middle of that range. */
export const GRADING_POLL_INTERVAL_MS = 2500;

/**
 * How old a still-unfinished job may get before the poll gives up: two
 * minutes, roughly 48 polls and well past any real grading latency — a
 * provider call is seconds, and even a retried one is well inside this.
 * Short enough that a guest whose job was never enqueued is not left
 * watching a spinner-less page for long.
 */
export const GRADING_POLL_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * How old an unfinished job may get before the pending screen says it is
 * taking longer than we aim for (BR-5.2, KAN-17). One minute is the
 * acceptance criterion's number, NOT an observed one: no grading has run
 * against a real provider yet, so nobody knows the real latency
 * distribution, and the Solution Architect has flagged that a model whose
 * thinking cannot be disabled may not meet it at all. Retune this against
 * measured latency once there is some; the guest-facing copy says "the
 * minute we aim for" (a statement about our target, true whatever the real
 * latency is) precisely so this constant can move without the copy lying.
 */
export const GRADING_SLOW_AFTER_MS = 60 * 1000;

export interface GradingStatus {
  readonly status: GradingJobStatus;
  /** Present only once `status === 'succeeded'` — what this caller may see of the grade (locked, full, or withheld). */
  readonly report: GradingReportView | null;
  /** Present only once `status === 'failed'` — and null even then if the server could not name a reason we recognise. */
  readonly failureReason: GradingFailureReason | null;
  /**
   * How old the job was when this answer arrived, in ms. Measured against
   * the server's own clock (the response's `Date` header) where there is
   * one, so a guest's wrong system clock cannot make every job look
   * stale — the client's clock is only the fallback. Null for a terminal
   * job, where it is not used.
   */
  readonly jobAgeMs: number | null;
}

/** The poll itself failed (as opposed to grading failing) — carries only the HTTP status and the route's structured `reason`, never body text. */
export class GradingStatusError extends Error {
  readonly httpStatus: number | null;
  readonly reason: RejectionReason | undefined;

  constructor(httpStatus: number | null, reason?: RejectionReason) {
    super(httpStatus === null ? 'grading status response was malformed' : `grading status request failed with status ${httpStatus}`);
    this.httpStatus = httpStatus;
    this.reason = reason;
  }

  /** A 4xx will not fix itself on a retry; a 5xx or a dropped connection might. */
  get isDefinitive(): boolean {
    return this.httpStatus !== null && this.httpStatus >= 400 && this.httpStatus < 500;
  }
}

function isTerminal(status: GradingJobStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/**
 * The job is still unfinished and has been for longer than
 * `GRADING_POLL_MAX_AGE_MS`: the poll has stopped, and nothing suggests the
 * job is still coming.
 */
export function isStalled(status: GradingStatus | undefined): boolean {
  return !!status && !isTerminal(status.status) && status.jobAgeMs !== null && status.jobAgeMs > GRADING_POLL_MAX_AGE_MS;
}

/**
 * Unfinished, past `GRADING_SLOW_AFTER_MS`, and not yet given up on.
 * `elapsedMs` is the MONOTONIC age from `usePendingElapsed`, not the raw
 * `jobAgeMs` of the last answer: the raw value can step back between polls
 * (see that hook), and a state derived from it would unlatch and be
 * announced again. `isStalled` still uses the raw value on purpose — once it
 * fires the poll stops, no further answer arrives and the value freezes, so
 * it latches by construction — and it wins here explicitly, so a job is
 * slow for the minute between the two bounds and stalled after it, never
 * both.
 */
export function isSlow(status: GradingStatus | undefined, elapsedMs: number | null): boolean {
  return !!status && !isTerminal(status.status) && !isStalled(status) && elapsedMs !== null && elapsedMs > GRADING_SLOW_AFTER_MS;
}

async function fetchGradingStatus(essayId: string): Promise<GradingStatus> {
  const response = await fetch(`/api/essays/${encodeURIComponent(essayId)}/grading`);
  if (!response.ok) {
    let reason: RejectionReason | undefined;
    try {
      const candidate = ((await response.json()) as { reason?: unknown } | null)?.reason;
      if (isRejectionReason(candidate)) reason = candidate;
    } catch {
      // Not JSON (a proxy error page, say) — the HTTP status alone stands.
    }
    throw new GradingStatusError(response.status, reason);
  }

  const body = (await response.json()) as Partial<Record<keyof GradingStatus | 'createdAt', unknown>> | null;
  const status = body?.status;
  if (typeof status !== 'string' || !(GRADING_JOB_STATUSES as readonly string[]).includes(status)) {
    throw new GradingStatusError(null);
  }
  let report: GradingReportView | null = null;
  if (status === 'succeeded') {
    // "Succeeded" with no report — or one this client cannot read, an
    // unrecognised `access` included — is not a grade we can show: surface it
    // as a failed poll rather than render an empty score.
    const parsed = gradingReportViewSchema.safeParse(body?.report);
    if (!parsed.success) throw new GradingStatusError(null);
    report = parsed.data;
  }

  let jobAgeMs: number | null = null;
  if (!isTerminal(status as GradingJobStatus)) {
    // Without a readable `createdAt` an unfinished job could never be given
    // up on, so it is treated like any other malformed answer rather than
    // polled forever.
    const createdAt = typeof body?.createdAt === 'string' ? Date.parse(body.createdAt) : Number.NaN;
    if (Number.isNaN(createdAt)) throw new GradingStatusError(null);
    const serverNow = Date.parse(response.headers.get('date') ?? '');
    jobAgeMs = (Number.isNaN(serverNow) ? Date.now() : serverNow) - createdAt;
  }

  const failureReason = body?.failureReason;
  return {
    status: status as GradingJobStatus,
    report,
    failureReason: isGradingFailureReason(failureReason) ? failureReason : null,
    jobAgeMs,
  };
}

export function useGradingStatus(essayId: string) {
  return useQuery<GradingStatus, Error>({
    queryKey: ['grading-status', essayId],
    queryFn: () => fetchGradingStatus(essayId),
    // The shared client's 5-minute staleTime is right for CMS content and
    // wrong here: a `pending` answer is stale the instant it arrives.
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const data = query.state.data;
      if (!data) return GRADING_POLL_INTERVAL_MS;
      return isTerminal(data.status) || isStalled(data) ? false : GRADING_POLL_INTERVAL_MS;
    },
    // A dropped connection is `TypeError`, not `GradingStatusError`, and is retryable.
    retry: (failureCount, error) => !(error instanceof GradingStatusError && error.isDefinitive) && failureCount < 3,
  });
}
