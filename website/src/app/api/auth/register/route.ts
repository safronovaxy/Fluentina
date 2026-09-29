import { NextRequest, NextResponse } from 'next/server';
import { registerRequestSchema } from '@/lib/contracts/auth';
import { guestSessionIdSchema, registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { registerAccount } from '@/lib/domain/registration';
import { checkRegistrationRateLimit } from '@/lib/domain/rate-limit';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { REGISTERED_SESSION_COOKIE_NAME, REGISTERED_SESSION_COOKIE_OPTIONS } from '@/lib/registered-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';
import { clientIp } from '@/lib/client-ip';
import { rejectionResponse } from '@/lib/rejection-response';
import { readBoundedJsonBody } from '@/lib/request-body';

/**
 * POST /api/auth/register — KAN-20. Creates the account, records consent
 * (KAN-21/22), converts the guest's session and essays to it, and signs the
 * new user in, atomically (`lib/db/users.ts::registerUser`).
 *
 * Email + password only: OAuth is dropped from the POC, and email verification
 * is sent by a later story (KAN-51) and does not block — the guest is signed
 * in and the report unlocks immediately (Irina, 2026-09-29).
 *
 * KNOWN CONSEQUENCE, recorded rather than papered over: because registration
 * auto-signs-in, it cannot return a neutral response for an address that
 * already has an account, so a 409 `emailAlreadyRegistered` is an
 * email-enumeration oracle. That follows directly from the auto-login
 * decision, and a fake success response would only hide it. The per-IP cap
 * (10/hour) is the mitigation, and it is a real one, not a complete one.
 *
 * Order of guards, cheapest first, mirroring `POST /api/essays`: cross-origin,
 * rate limit (needs only the IP and the guest cookie — so it runs BEFORE the
 * body is read), body-size guard, JSON, schema. The guest cookie is read here
 * and offered to conversion, never RESOLVED: `resolveGuestSession` mints a
 * session for a missing or unusable cookie, which is exactly what a
 * registration must not do.
 *
 * `Set-Cookie` is written only after `registerAccount` returns, i.e. after the
 * transaction has committed. The guest cookie is cleared in the same response,
 * with the SAME attributes and `maxAge: 0` — a `__Host-` cookie is not cleared
 * by a delete that omits `Secure` or `Path=/`. Clearing is not cosmetic: after
 * conversion the stale guest cookie authorises nothing, but it still names a
 * real converted row, which is exactly the input that drives
 * `resolveGuestSession` down its `SessionIdUnavailableError` branch and mints a
 * fresh `guest_sessions` row on every guest-flow page load — walking every new
 * user into the rate limit meant for abusers (KAN-25).
 *
 * Never logs the request body, the email or the password. A failure logs a
 * fixed event name and nothing else.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');
  }

  // A malformed cookie is treated as absent: it could never have named a
  // session, and keying a rate-limit bucket on attacker-chosen garbage would
  // hand them a fresh bucket per request.
  const guestParse = guestSessionIdSchema.safeParse(request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value);
  const guestSessionId = guestParse.success ? guestParse.data : null;
  const presentedParse = registeredSessionTokenSchema.safeParse(request.cookies.get(REGISTERED_SESSION_COOKIE_NAME)?.value);
  const presentedSessionToken = presentedParse.success ? presentedParse.data : null;

  try {
    if (!(await checkRegistrationRateLimit(guestSessionId, clientIp(request)))) {
      return rejectionResponse('rateLimited', 429, 'too many registration attempts — try again later');
    }
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'registration_failed', stage: 'rateLimit' }));
    return rejectionResponse('internalError', 500, 'could not register');
  }

  const body = await readBoundedJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = registerRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    return rejectionResponse('invalidSubmission', 400, 'invalid registration request');
  }

  let outcome: Awaited<ReturnType<typeof registerAccount>>;
  try {
    outcome = await registerAccount(parsed.data, { guestSessionId, presentedSessionToken });
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'registration_failed', stage: 'register' }));
    return rejectionResponse('internalError', 500, 'could not register');
  }

  if (outcome.status === 'emailAlreadyRegistered') {
    return rejectionResponse('emailAlreadyRegistered', 409, 'an account with this email already exists');
  }

  const response = NextResponse.json({ ok: true }, { status: 201 });
  response.cookies.set(REGISTERED_SESSION_COOKIE_NAME, outcome.token, REGISTERED_SESSION_COOKIE_OPTIONS);
  response.cookies.set(GUEST_SESSION_COOKIE_NAME, '', { ...GUEST_SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
