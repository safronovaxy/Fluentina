import 'server-only';

/**
 * KAN-19 — the one place an HTTP request becomes an `OwnerActor`.
 *
 * Both adapters that read a guest's grade (`GET /api/essays/[id]/grading` and
 * the preview page) used to inline the same four lines, each hard-coding the
 * assumption that the only possible actor is a guest. They share this instead.
 *
 * It takes a cookie READER, not a `NextRequest`, so the route handler
 * (`request.cookies`) and the Server Component (`await cookies()`) share one
 * implementation without the domain layer importing `next/server`.
 *
 * `async` because the registered-session lookup is a `sessions` row read
 * (KAN-20). The signature was fixed before that story landed, to keep it from
 * churning both call sites.
 *
 * ORDER MATTERS: a registered session is tried first, the guest cookie only
 * as a fallback. After a guest converts, `ownedBy` for a `GuestActor` requires
 * `user_id IS NULL`, so building a `GuestActor` from a converted user's stale
 * guest cookie would 404 the owner on their own essay. Guest-first is a bug
 * that only appears once registration ships, and is miserable to diagnose
 * then — `owner-actor.test.ts` pins the order.
 *
 * `null` means "no usable identity" (no session and no well-formed guest
 * cookie). Adapters decide what that looks like over HTTP.
 */
import { guestSessionIdSchema, type OwnerActor } from '@/lib/contracts/actor';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { resolveRegisteredSession } from './registered-session';

export async function resolveOwnerActor(readCookie: (name: string) => string | undefined): Promise<OwnerActor | null> {
  const user = await resolveRegisteredSession(readCookie);
  if (user) return user;

  const guestSessionId = guestSessionIdSchema.safeParse(readCookie(GUEST_SESSION_COOKIE_NAME));
  if (!guestSessionId.success) return null;
  return { kind: 'guest', sessionId: guestSessionId.data };
}
