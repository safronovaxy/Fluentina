import { NextRequest, NextResponse } from 'next/server';
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
 * handover, not decided unilaterally here.
 *
 * Deliberately tolerant of a body-less or malformed request in exactly one
 * way: an invalid/missing `jobId` is a 400 (a Cloud Tasks configuration bug,
 * not a job to retry), but any THROW from `runGradingJob` itself is caught
 * and still answered 200 — `runGradingJob` already persists a `failed` job
 * row and a KAN-24 telemetry line for every failure it can classify (see its
 * own comment); asking Cloud Tasks to retry a failure that has already been
 * recorded would risk double-billing a provider call, not recover anything.
 * Only a failure that happens BEFORE this route's own try block (an
 * unreadable request body) is left to surface as an unhandled 500, which is
 * the one case where a Cloud Tasks retry is actually useful.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GRADING_TASK_SECRET;
  if (!secret || request.headers.get('x-grading-task-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const jobId = typeof body === 'object' && body !== null && 'jobId' in body ? (body as { jobId: unknown }).jobId : undefined;
  if (typeof jobId !== 'string' || jobId.length === 0) {
    return NextResponse.json({ error: 'missing or invalid jobId' }, { status: 400 });
  }

  try {
    await runGradingJob(jobId);
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
