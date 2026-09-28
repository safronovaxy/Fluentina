'use client';

/**
 * KAN-18 — polls `GET /api/essays/[id]/grading` (KAN-16, ADR-2: "every 2-3
 * seconds until the job is ready") with TanStack Query's own
 * `refetchInterval`, not a hand-rolled timer, so the interval stops the
 * moment the job reaches a terminal state, pauses in a hidden tab, and is
 * torn down on unmount without any of that being this file's to get right.
 *
 * Only the fields the preview needs are read out of the response — see
 * `lib/contracts/grading-job.ts` for the full shape; dates arrive as JSON
 * strings and nothing here needs them.
 *
 * Nothing about the job is logged: a `GradingResult` can carry annotation
 * text that quotes the guest's essay, and this is client code anyway — no
 * `console.*` here, ever.
 */
import { useQuery } from '@tanstack/react-query';
import { GRADING_JOB_STATUSES, type GradingJobStatus } from '@/lib/contracts/grading-job';
import { isGradingFailureReason, type GradingFailureReason, type GradingResult } from '@/lib/contracts/grading';
import { isRejectionReason, type RejectionReason } from '@/lib/contracts/rejection-reason';

/** ADR-2 says 2-3 seconds; the middle of that range. */
export const GRADING_POLL_INTERVAL_MS = 2500;

export interface GradingStatus {
  readonly status: GradingJobStatus;
  /** Present only once `status === 'succeeded'`. */
  readonly result: GradingResult | null;
  /** Present only once `status === 'failed'` — and null even then if the server could not name a reason we recognise. */
  readonly failureReason: GradingFailureReason | null;
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

  const body = (await response.json()) as Partial<Record<keyof GradingStatus, unknown>> | null;
  const status = body?.status;
  if (typeof status !== 'string' || !(GRADING_JOB_STATUSES as readonly string[]).includes(status)) {
    throw new GradingStatusError(null);
  }
  const result = (body?.result ?? null) as GradingResult | null;
  // "Succeeded" with no result is not a grade we can show — surface it as a
  // failed poll rather than render an empty score.
  if (status === 'succeeded' && result === null) throw new GradingStatusError(null);

  const failureReason = body?.failureReason;
  return {
    status: status as GradingJobStatus,
    result,
    failureReason: isGradingFailureReason(failureReason) ? failureReason : null,
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
      const status = query.state.data?.status;
      return status && isTerminal(status) ? false : GRADING_POLL_INTERVAL_MS;
    },
    // A dropped connection is `TypeError`, not `GradingStatusError`, and is retryable.
    retry: (failureCount, error) => !(error instanceof GradingStatusError && error.isDefinitive) && failureCount < 3,
  });
}
