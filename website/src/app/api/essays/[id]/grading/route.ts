import { NextRequest, NextResponse } from 'next/server';
import { getGradingStatus } from '@/lib/domain/grading/grading-status';
import { resolveOwnerActor } from '@/lib/domain/owner-actor';
import { isCrossOriginRequest } from '@/lib/same-origin';
import { rejectionResponse } from '@/lib/rejection-response';

/**
 * GET /api/essays/[id]/grading — KAN-16 / ADR-2's status-polling endpoint.
 * "The frontend polls a status endpoint every 2-3 seconds until the job is
 * ready" is the ADR's own framing; this route is that endpoint. A guest's
 * own poller (KAN-18's preview screen, not built by this story) calls this
 * repeatedly with no side effects — the ownership guard below is the same
 * "not found and not yours are outwardly identical" rule the rest of this
 * codebase already applies (see `getEssayById`'s own comment), so this
 * cannot be used to enumerate other guests' essay ids by status-code probing.
 *
 * Deliberately does NOT call `resolveGuestSession` — unlike `POST
 * /api/essays`, a read has no reason to create a `guest_sessions` row (or
 * reissue a cookie) for a caller whose cookie names one that doesn't exist
 * yet. Who is asking is `resolveOwnerActor`'s to say (KAN-19): a registered
 * session first, the schema-validated guest cookie only as a fallback — the
 * same "raw, validated identity, no row lookup required" shape
 * `lib/domain/rate-limit.ts`'s own checks already use. `ownedBy()`
 * (`lib/db/ownership.ts`) compares a guest's value only against
 * `essays.session_id` and checks `essays.user_id IS NULL` — it never touches
 * `guest_sessions` at all, so no session row needs to exist for this
 * ownership check to be correct.
 *
 * What is SENT is decided by `getGradingStatus`, per actor (KAN-19, BR-4.2):
 * a guest gets a locked teaser, never the full result, and a flagged result is
 * withheld from everyone. The route only serialises what it is handed, and
 * this is deliberately not where the rule lives — see that function's comment.
 *
 * `Cache-Control: private, no-store` is set explicitly: the same URL now
 * answers with different entitlement levels depending on who asks, with a
 * load balancer in front of Cloud Run, so whether an intermediary may cache
 * it is not left to whatever Next emits for a cookie-reading dynamic route.
 *
 * Same cross-origin guard as `/api/essays` and `/api/guest-session` — see
 * either route's own comment for the full reasoning. A GET has no state-
 * changing side effect of its own here, but the response body IS guest-
 * specific data (a grading result), so the same defence-in-depth applies.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossOriginRequest(request)) {
    return rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');
  }

  const actor = await resolveOwnerActor((name) => request.cookies.get(name)?.value);
  if (!actor) {
    return rejectionResponse('invalidSessionCookie', 400, 'missing or invalid guest session cookie');
  }

  const { id } = await params;

  const job = await getGradingStatus(actor, id);
  if (!job) {
    // Deliberately one reason for "no such essay", "essay isn't yours", and
    // "essay exists, is yours, but grading was never enqueued for it" (a
    // narrow race — see start-grading.ts's own comment on ordering) — none
    // of these should read differently to an outside caller; only the first
    // two are actual ownership-sensitive cases, but a caller cannot be
    // allowed to distinguish "not enqueued yet" from "not yours" either,
    // since that would leak which of the two is true for an id that isn't
    // theirs.
    return rejectionResponse('gradingJobNotFound', 404, 'no grading job found for this essay');
  }

  return NextResponse.json(job, { headers: { 'Cache-Control': 'private, no-store' } });
}
