/**
 * Same-origin guard for the two POST endpoints that accept the guest
 * session cookie with no other authentication: `src/app/api/guest-session/
 * route.ts` (KAN-10) and `src/app/api/essays/route.ts` (KAN-14). Extracted
 * here, rather than left duplicated, once a second route needed the exact
 * same check — see `route.ts`'s own comment for why this exists and what it
 * does and doesn't actually guarantee; that reasoning lives there and is
 * not restated per call site.
 *
 * Plain adapter-level code, deliberately outside `lib/domain`, `lib/db` and
 * `lib/contracts` (ADR-14, same reasoning as `guest-session-cookie.ts` next
 * to this file): comparing an `Origin` header against a forwarded-host
 * header is an HTTP/framework concern nothing under those three layers may
 * know exists.
 *
 * `forwardedHost` is NOT a reusable trusted primitive beyond this one
 * check — see `route.ts`'s own comment on why `x-forwarded-host` is
 * client-supplied and unverified here. Do not reach for this module to
 * answer "what host did this request actually arrive on"; it only answers
 * "does the Origin this request claims agree with the Host/forwarded-host
 * it also claims", which is weaker, and is exactly the caveat this guard
 * has always carried.
 */
import type { NextRequest } from 'next/server';

/**
 * True when a request's `Origin` header, if present, disagrees with the
 * host it claims to be for. Absence of `Origin` itself is never a
 * mismatch — a same-origin fetch may omit it — but absence or malformation
 * on the OTHER side (no Host/x-forwarded-host at all, or an unparseable
 * Origin) always is: two `null`s are not a match, they're two ways of
 * having nothing to compare. See `originHost`/`forwardedHost` below for
 * what each side actually reads.
 */
export function isCrossOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const claimed = originHost(origin);
  const actual = forwardedHost(request);
  return claimed === null || actual === null || claimed !== actual;
}

/**
 * The host `Origin` claims to be from, or `null` if `Origin` isn't even a
 * parseable URL. A malformed header is always treated as a mismatch by
 * `isCrossOriginRequest`, never as "absent".
 */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * `x-forwarded-host` if present, else `host`. NOT "the host from the
 * proxy's point of view" — nothing proxy-side sets `x-forwarded-host` in
 * this deployment (see `route.ts`'s own comment on the load balancer in
 * front of Cloud Run). This is a client-supplied value taken on faith.
 * Deliberately not `request.nextUrl.host`: under `output: standalone`
 * that is the container bind address, not anything a browser sent — see
 * `route.ts`'s own comment for the production bug that reading it caused.
 */
function forwardedHost(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}
