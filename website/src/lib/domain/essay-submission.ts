import 'server-only';

/**
 * KAN-14 — persists a guest's essay under an already-resolved actor.
 * Storage only: grading is KAN-16's job, the recommended-length/word-count
 * UI and its server-side counterpart are KAN-15's, and this function does
 * not know either of those stories exists — KAN-15 landed its check in
 * `essaySubmissionRequestSchema` (`lib/contracts/essay-submission.ts`), not
 * here: `lib/domain` is `server-only`, and the same word-count rule has to
 * run in the browser too, for the live counter — see that schema's own
 * comment, and `lib/contracts/word-count.ts`.
 *
 * Round-1 review (blocking): this used to take the raw, possibly-absent
 * cookie value itself and resolve it (via `resolveGuestSession`), which
 * meant an adapter could call it with `undefined` and get a session minted
 * in return — reintroducing, on this route, the exact "second,
 * unauthenticated cookie issuer" property `/api/guest-session` spent three
 * review rounds removing (see that route's own comment). Resolution is now
 * the CALLER's job — `src/app/api/essays/route.ts` validates the cookie
 * against `guestSessionIdSchema` and calls `resolveGuestSession` itself,
 * the same as `/api/guest-session` does, before this function ever runs.
 * That also gives the route a resolved `Actor` in hand without resolving
 * twice, which is what KAN-25's rate limiter needs to key on (see the
 * route's own comment).
 *
 * This function's only remaining job is the insert: `createEssay`
 * (lib/db/essays.ts), inside a transaction that locks the session row so a
 * write racing a concurrent conversion can never land unattached. Kept as a
 * named seam in `lib/domain` rather than the route calling `lib/db`
 * directly, for the ADR-14 layering (adapters talk to domain, domain talks
 * to db).
 */
import { createEssay } from '@/lib/db/essays';
import type { GuestActor } from '@/lib/contracts/actor';
import type { Essay } from '@/lib/contracts/essay';

/**
 * Persists `content` under `actor` — the id the CALLER already resolved
 * (and, if necessary, reissued a cookie for). `content` is taken as-is —
 * already validated (shape, the KAN-14 character-cap safety limit, and
 * KAN-15's real 50-300 word-count bounds) by the adapter's own
 * request-schema check (`essaySubmissionRequestSchema`) before this is ever
 * called.
 */
export async function submitEssay(actor: GuestActor, content: string): Promise<Essay> {
  return createEssay(actor, content);
}
