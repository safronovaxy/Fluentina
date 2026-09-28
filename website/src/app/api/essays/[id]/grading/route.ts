import { NextRequest, NextResponse } from 'next/server';
import { getGradingStatus } from '@/lib/domain/grading/grading-status';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import type { GuestActor } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
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
 * yet; a `GuestActor` is built directly from the schema-validated cookie
 * value, the same "raw, validated identity, no row lookup required" shape
 * `lib/domain/rate-limit.ts`'s own checks already use. `ownedBy()`
 * (`lib/db/ownership.ts`) only ever compares this value against
 * `essays.session_id` and checks `essays.user_id IS NULL` — it never touches
 * `guest_sessions` at all, so no session row needs to exist for this
 * ownership check to be correct.
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

  const rawCookie = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  const cookieParse = guestSessionIdSchema.safeParse(rawCookie);
  if (!cookieParse.success) {
    return rejectionResponse('invalidSessionCookie', 400, 'missing or invalid guest session cookie');
  }

  const actor: GuestActor = { kind: 'guest', sessionId: cookieParse.data };
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

  return NextResponse.json(job);
}
