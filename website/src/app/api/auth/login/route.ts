import { NextRequest, NextResponse } from 'next/server';
import { loginRequestSchema } from '@/lib/contracts/auth';
import { guestSessionIdSchema, registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { login } from '@/lib/domain/login';
import { checkLoginRateLimit } from '@/lib/domain/rate-limit';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { REGISTERED_SESSION_COOKIE_NAME, REGISTERED_SESSION_COOKIE_OPTIONS } from '@/lib/registered-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';
import { clientIp } from '@/lib/client-ip';
import { rejectionResponse } from '@/lib/rejection-response';
import { readBoundedJsonBody } from '@/lib/request-body';

/**
 * POST /api/auth/login — KAN-20.
 *
 * Rate limited on TWO buckets, both always checked, neither short-circuiting:
 * 30 per IP per hour and 10 per email per hour (`checkLoginRateLimit` carries
 * the case for needing both). The email bucket needs the parsed email, so the
 * check runs after the body is read and validated — a request that fails the
 * schema is refused as a bad request and counts against neither bucket.
 *
 * Every credential failure — no such account, wrong password — is the same
 * 401, the same `invalidCredentials` reason and the same message, and performs
 * the same single scrypt verification (`lib/domain/login.ts`). Nothing in this
 * route may branch on which of the two it was.
 *
 * Sign-in adopts whatever guest essay the browser is holding (KAN-52; Irina,
 * 2026-09-29): the guest cookie is read here and offered to adoption, never
 * RESOLVED — `resolveGuestSession` mints for a missing or unusable cookie, which
 * a sign-in must not do. A malformed value is treated as absent, as
 * registration does: it could never have named a session. The guest cookie
 * plays no part in the rate-limit key — login's two buckets are per IP and per
 * email, and keying on an attacker-chosen cookie would hand them a fresh
 * bucket per request.
 *
 * On success the guest cookie is CLEARED in the same response, with the SAME
 * attributes and `maxAge: 0` — a `__Host-` cookie is not cleared by a delete
 * that omits `Secure` or `Path=/`. Clearing is not cosmetic: after adoption the
 * stale guest cookie authorises nothing, but it still names a real converted
 * row, which is exactly the input that drives `resolveGuestSession` down its
 * `SessionIdUnavailableError` branch and mints a fresh `guest_sessions` row on
 * every guest-flow page load — walking every signed-in user into the rate limit
 * meant for abusers (KAN-25). It is cleared whether or not adoption found
 * anything to adopt (a retention-deleted session, a second tab): either way the
 * cookie is dead weight. `Set-Cookie` is written only after `login` returns, i.e.
 * after the transaction has committed; a failed or refused sign-in leaves the
 * guest cookie alone, so a mistyped password does not cost a guest their essay.
 *
 * Failures here are logged as a fixed event name only: never the email, never
 * the password, never the body.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');
  }

  const body = await readBoundedJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = loginRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    return rejectionResponse('invalidSubmission', 400, 'invalid login request');
  }

  const presentedParse = registeredSessionTokenSchema.safeParse(request.cookies.get(REGISTERED_SESSION_COOKIE_NAME)?.value);
  const guestParse = guestSessionIdSchema.safeParse(request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value);

  let outcome: Awaited<ReturnType<typeof login>>;
  try {
    if (!(await checkLoginRateLimit(parsed.data.email, clientIp(request)))) {
      return rejectionResponse('rateLimited', 429, 'too many login attempts — try again later');
    }
    outcome = await login(parsed.data, {
      guestSessionId: guestParse.success ? guestParse.data : null,
      presentedSessionToken: presentedParse.success ? presentedParse.data : null,
    });
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'login_failed' }));
    return rejectionResponse('internalError', 500, 'could not sign in');
  }

  if (outcome.status === 'invalidCredentials') {
    return rejectionResponse('invalidCredentials', 401, 'invalid email or password');
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(REGISTERED_SESSION_COOKIE_NAME, outcome.token, REGISTERED_SESSION_COOKIE_OPTIONS);
  response.cookies.set(GUEST_SESSION_COOKIE_NAME, '', { ...GUEST_SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
