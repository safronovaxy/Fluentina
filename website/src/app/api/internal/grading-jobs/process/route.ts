import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runGradingJob } from '@/lib/domain/grading/orchestrate-grading';

/**
 * POST /api/internal/grading-jobs/process — ADR-2's "protected HTTP
 * endpoint" Cloud Tasks invokes in production. Never called by any real
 * guest-facing flow, and never called at all in this repo's own dev/test
 * configuration — `lib/domain/grading/queue.ts`'s inline path calls
 * `runGradingJob` directly, in-process, with no HTTP round trip. This route
 * exists only for `GRADING_QUEUE_MODE=cloud-tasks` (production).
 *
 * "Protected" today means one thing: the caller must present the exact
 * `GRADING_TASK_SECRET` this deployment was configured with, as
 * `X-Grading-Task-Secret`. `queue.ts`'s own Cloud Tasks task also attaches
 * an OIDC token (`oidcToken.serviceAccountEmail`) Cloud Tasks itself signs
 * on delivery — this route does NOT verify that token's signature, which
 * would need either a JWKS fetch and RS256 verification (no JWT library is
 * a dependency of this app today) or Cloud Run's own IAM invoker check
 * (unavailable per-route on a service that also serves public marketing
 * pages under the same Cloud Run service — see CLAUDE.md's Infrastructure
 * section). The shared secret is the honest, shippable Phase 1 answer;
 * upgrading to real OIDC verification is flagged in this story's own
 * handover, not decided unilaterally here. KAN-16 round-1 review, finding
 * 15, hardens the shared-secret check itself (the approach was accepted;
 * the implementation wasn't): constant-time comparison, a minimum secret
 * length so a misconfigured/empty secret can't accidentally authorise every
 * caller, and a log line for a rejected call so credential brute force, a
 * stale secret after rotation, and a misconfigured queue stop looking
 * identical to silence.
 *
 * Retry contract (KAN-16 round-1 review, finding 13 — this comment and
 * `mistral-provider.ts`'s own used to contradict each other; this one wins,
 * and that one was updated to match): a `providerError` (transient —
 * network failure, non-2xx, timeout) is retried, up to
 * `MAX_PROVIDER_RETRY_ATTEMPTS` deliveries, by reverting the job to
 * `pending` and answering 503 so Cloud Tasks redelivers it — derived from
 * the `X-CloudTasks-TaskRetryCount` header Cloud Tasks attaches on every
 * delivery (0 on the first). Once that budget is exhausted, or for any other
 * classified failure (`invalidProviderResponse`, `wordCountOutOfBounds`,
 * `essayMissing`, `unknown`), the job is recorded terminally `failed` and
 * this route answers 200 — `runGradingJob` already persists a KAN-24
 * telemetry line for it, so asking Cloud Tasks to retry a failure that's
 * already been recorded terminally would risk double-billing a provider
 * call, not recover anything. This route's own retry budget
 * (`MAX_PROVIDER_RETRY_ATTEMPTS`) is self-contained across exactly
 * `MAX_PROVIDER_RETRY_ATTEMPTS` deliveries (`retryCount` 0, 1, 2 for a
 * budget of 3): `isFinalAttempt` compares against
 * `MAX_PROVIDER_RETRY_ATTEMPTS - 1`, not `MAX_PROVIDER_RETRY_ATTEMPTS`,
 * specifically so the last delivery this budget allows is answered 200
 * (terminal `failed`, telemetry recorded) rather than a 503 nothing then
 * redelivers. Round-2 review measured the off-by-one this replaced: at
 * `retryCount >= MAX_PROVIDER_RETRY_ATTEMPTS`, deliveries 0, 1 and 2 all
 * still answered 503, so a queue configured with `maxAttempts: 3` (KAN-38)
 * gave up after its third delivery with the job left `pending` forever —
 * no terminal row, no telemetry line, silent. This arithmetic is what
 * removes the trap of needing `maxAttempts >= MAX_PROVIDER_RETRY_ATTEMPTS +
 * 1` in a separate repo (the Cloud Tasks queue config) to avoid it; state
 * the queue's own `maxAttempts`/`maxRetryDuration`, and the dead-letter
 * question (Cloud Tasks has no native DLQ — a task that exhausts
 * `maxAttempts` is simply dropped), explicitly before provisioning it for a
 * route that calls a paid API — see this story's own handover, and
 * KAN-38 for the still-open stuck-`processing` case this doesn't close
 * (this file's claim function has its own `TODO(KAN-38)`).
 *
 * Deliberately tolerant of a body-less or malformed request in exactly one
 * way: an invalid/missing `jobId` is a 400 (a Cloud Tasks configuration bug,
 * not a job to retry), but any THROW from `runGradingJob` itself is caught
 * and still answered 200 or 503 per the retry contract above — never a 500
 * for a failure `runGradingJob` already classified and recorded. Only a
 * failure that happens BEFORE this route's own try block (an unreadable
 * request body) is left to surface as an unhandled 500, which is the one
 * case where a Cloud Tasks retry is actually useful.
 */

/** A misconfigured (empty, or implausibly short/guessable) secret must refuse to serve the route at all, never fall through to comparing against it. */
const MIN_SECRET_LENGTH = 32;

/** The total number of deliveries this route allows before treating a `providerError` as terminal — see this file's own top comment for how `isFinalAttempt` derives that from `retryCount`. */
const MAX_PROVIDER_RETRY_ATTEMPTS = 3;

const jobIdSchema = z.string().uuid();

/** Constant-time comparison on equal-length buffers, length-checked first — a plain `!==` on a secret header is a timing side-channel. */
function timingSafeSecretMatch(presented: string, expected: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  if (presentedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(presentedBuffer, expectedBuffer);
}

function logRejection(reason: 'misconfiguredSecret' | 'badSecret'): void {
  // Metadata only — never the header value, never the body. See this file's
  // own top comment (finding 15): a rejected call used to be silent, making
  // credential brute force, a stale secret after rotation, and a
  // misconfigured queue all look identical from the logs.
  console.warn(JSON.stringify({ severity: 'WARNING', event: 'grading_task_process_rejected', reason }));
}

export async function POST(request: NextRequest) {
  const secret = process.env.GRADING_TASK_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    logRejection('misconfiguredSecret');
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }

  const presented = request.headers.get('x-grading-task-secret');
  if (!presented || !timingSafeSecretMatch(presented, secret)) {
    logRejection('badSecret');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const rawJobId = typeof body === 'object' && body !== null && 'jobId' in body ? (body as { jobId: unknown }).jobId : undefined;
  const jobIdResult = jobIdSchema.safeParse(rawJobId);
  if (!jobIdResult.success) {
    return NextResponse.json({ error: 'missing or invalid jobId' }, { status: 400 });
  }
  const jobId = jobIdResult.data;

  // Cloud Tasks attaches this on every delivery, 0 on the first — absent
  // entirely outside Cloud Tasks (e.g. a hand-crafted request during local
  // testing of this route), which this treats as "no budget left" rather
  // than trusting an absent header to mean "first attempt".
  const retryCountHeader = request.headers.get('x-cloudtasks-taskretrycount');
  const retryCount = retryCountHeader === null ? null : Number(retryCountHeader);
  // `MAX_PROVIDER_RETRY_ATTEMPTS - 1`, not `MAX_PROVIDER_RETRY_ATTEMPTS`: `retryCount` is
  // zero-based, so comparing against the raw budget let deliveries 0 through
  // `MAX_PROVIDER_RETRY_ATTEMPTS - 1` ALL answer 503, and only a delivery beyond the budget was
  // ever final — see this file's own top comment for the stuck-`pending` failure that produced.
  const isFinalAttempt =
    retryCount === null || !Number.isFinite(retryCount) || retryCount >= MAX_PROVIDER_RETRY_ATTEMPTS - 1;

  try {
    // `runGradingJob`'s own return value — not a second read of the job row
    // — is what tells this route whether to ask Cloud Tasks to redeliver.
    // Reaching back into `lib/db/grading-jobs` here would violate ADR-14's
    // layering rule (adapters import `lib/domain`, never `lib/db`), the same
    // rule every other route in this codebase already follows.
    const outcome = await runGradingJob(jobId, { isFinalAttempt });
    if (outcome === 'retryable') {
      return NextResponse.json({ ok: false, retry: true }, { status: 503 });
    }
  } catch {
    // Should be unreachable — `runGradingJob` catches everything it can
    // classify internally (see its own comment). No message logged here,
    // deliberately: whatever escaped that handling could in principle be a
    // database error whose own message embeds more than this route can
    // verify is safe (the same class of risk `lib/db/essays.ts`'s own
    // KAN-24 fix addresses) — the fact that something DID escape is the
    // only thing worth a line here.
    console.error(JSON.stringify({ severity: 'ERROR', event: 'grading_job_process_route_uncaught' }));
  }

  return NextResponse.json({ ok: true });
}
