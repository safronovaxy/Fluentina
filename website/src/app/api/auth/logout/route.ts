import { NextRequest, NextResponse } from 'next/server';
import { registeredSessionTokenSchema } from '@/lib/contracts/actor';
import { endRegisteredSession } from '@/lib/domain/registered-session';
import { REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS, REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';
import { rejectionResponse } from '@/lib/rejection-response';

/**
 * POST /api/auth/logout — KAN-20.
 *
 * DELETES the session's row, THEN clears the cookie. Clearing only the cookie
 * leaves a live credential in the database — anyone holding the token can keep
 * using it — and discards the entire reason sessions live in a table. If the
 * delete fails, this returns 500 and does NOT clear the cookie: reporting
 * "signed out" while the credential is still live would be worse than an
 * error the person can retry.
 *
 * Idempotent: no cookie, a malformed one, or a token naming no live session is
 * still 200 with the cookie cleared — there is nothing left to revoke.
 *
 * POST only, like every state-changing endpoint here. The session cookie is
 * `SameSite=Lax`, which the browser sends on top-level cross-site GET
 * navigations (see `lib/registered-session-cookie.ts`); a logout that answered
 * GET could be triggered by a link.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');
  }

  const parsed = registeredSessionTokenSchema.safeParse(request.cookies.get(REGISTERED_SESSION_COOKIE_NAME)?.value);
  if (parsed.success) {
    try {
      await endRegisteredSession(parsed.data);
    } catch {
      console.error(JSON.stringify({ severity: 'ERROR', event: 'logout_failed' }));
      return rejectionResponse('internalError', 500, 'could not sign out');
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(REGISTERED_SESSION_COOKIE_NAME, '', REGISTERED_SESSION_COOKIE_CLEAR_OPTIONS);
  return response;
}
