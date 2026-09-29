import { NextRequest, NextResponse } from 'next/server';
import { loginRequestSchema } from '@/lib/contracts/auth';
import { registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { login } from '@/lib/domain/login';
import { checkLoginRateLimit } from '@/lib/domain/rate-limit';
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

  let outcome: Awaited<ReturnType<typeof login>>;
  try {
    if (!(await checkLoginRateLimit(parsed.data.email, clientIp(request)))) {
      return rejectionResponse('rateLimited', 429, 'too many login attempts — try again later');
    }
    outcome = await login(parsed.data, presentedParse.success ? presentedParse.data : null);
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'login_failed' }));
    return rejectionResponse('internalError', 500, 'could not sign in');
  }

  if (outcome.status === 'invalidCredentials') {
    return rejectionResponse('invalidCredentials', 401, 'invalid email or password');
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(REGISTERED_SESSION_COOKIE_NAME, outcome.token, REGISTERED_SESSION_COOKIE_OPTIONS);
  return response;
}
