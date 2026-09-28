/**
 * KAN-24 (carried-over PR note #1) — `POST /api/guest-session`'s two 400
 * branches (a cross-origin request, a missing/malformed session cookie) used
 * to be silent in Cloud Logging: nothing counted them, so a broken cookie
 * guard rejecting every real guest looked identical to one that never fired
 * at all. This is the one structured line either branch emits — `status`
 * and `reason` only, per this note's own instruction: never the session id
 * (there usually isn't a validated one to log at this point anyway — that's
 * exactly what these two branches mean), and never any request body.
 *
 * Lives in `lib/` (alongside `same-origin.ts`, `rejection-response.ts`), not
 * `lib/domain` — it touches no database, no `Actor`, and is framework-
 * adjacent adapter code the same way its neighbours are (see
 * `rejection-response.ts`'s own comment on why THAT file sits here and not
 * in `lib/contracts` or `lib/domain`).
 */
import type { RejectionReason } from './contracts/rejection-reason';

export function logGuestSessionRejection(status: number, reason: RejectionReason): void {
  console.log(
    JSON.stringify({
      severity: 'WARNING',
      event: 'guest_session_rejected',
      status,
      reason,
    }),
  );
}
