import { isRejectionReason, type RejectionReason } from '@/lib/contracts/rejection-reason';

/**
 * KAN-55 — the browser half of `POST /api/auth/register` and `/login`.
 *
 * A failure carries the HTTP status and the route's structured `reason` and
 * NOTHING else: the `error` message text is never read out of the body (the
 * same rule `EssayEntryForm`'s `postEssay` follows), and no field of the
 * request is ever put in a message or thrown value, so an email or a password
 * cannot leak into a log line or an error boundary through here. The body of a
 * failed response may not be JSON at all (a proxy error page), so reading it
 * is best effort and a parse failure leaves `reason` undefined.
 *
 * There is exactly one code path for every non-2xx answer. In particular
 * nothing here looks at the status to decide what to do, so a 401 for an
 * unknown email and a 401 for a wrong password cannot be told apart by this
 * code, in content or in timing: it does not add a delay, a retry or a
 * different branch for either.
 */
export class AuthRequestError extends Error {
  readonly httpStatus: number;
  readonly reason: RejectionReason | undefined;

  constructor(httpStatus: number, reason: RejectionReason | undefined) {
    super(`auth request failed with status ${httpStatus}`);
    this.httpStatus = httpStatus;
    this.reason = reason;
  }
}

export type AuthEndpoint = '/api/auth/register' | '/api/auth/login';

export async function postAuth(endpoint: AuthEndpoint, body: unknown): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;

  let reason: RejectionReason | undefined;
  try {
    const candidate = ((await response.json()) as { reason?: unknown } | null)?.reason;
    if (isRejectionReason(candidate)) reason = candidate;
  } catch {
    // Not JSON, or no body — the status alone stands.
  }
  throw new AuthRequestError(response.status, reason);
}
