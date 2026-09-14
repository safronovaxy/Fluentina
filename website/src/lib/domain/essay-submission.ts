import 'server-only';

/**
 * KAN-14 — persists a guest's essay. Storage only: grading is KAN-16's job,
 * the recommended-length/word-count UI and its server-side counterpart are
 * KAN-15's, and this function does not know either of those stories exists.
 *
 * Composes two already-reviewed primitives rather than reinventing either:
 * `resolveGuestSession` (KAN-10, lib/domain/guest-session.ts) turns whatever
 * raw cookie value the adapter read into a trustworthy `GuestActor`,
 * creating the session's row on first use; `createEssay` (lib/db/essays.ts)
 * inserts the essay under that actor, inside a transaction that locks the
 * session row so a write racing a concurrent conversion can never land
 * unattached. Neither of those concerns belongs here a second time.
 *
 * The one thing THIS function exists to get right: it inserts under
 * `actor.sessionId` — the id `resolveGuestSession` resolved to — never
 * under whatever raw value the adapter originally read from the cookie.
 * Those two differ exactly when `reissued` is true (see that field's own
 * doc comment): the presented cookie named a session that turned out to be
 * unavailable (most often, converted to a registered account), a fresh id
 * was minted, and the browser's cookie is now stale. Writing under the
 * stale id instead would insert an essay under a session the caller has no
 * way to set a cookie for — the row would exist, but nothing could ever
 * read it back, right up until retention quietly deletes it. There is no
 * separate branch for that case below because there doesn't need to be:
 * `actor` already IS the resolved id, reissued or not, so simply using it
 * is the fix, not a special case of one.
 */
import { resolveGuestSession } from './guest-session';
import { createEssay } from '@/lib/db/essays';
import type { Essay } from '@/lib/contracts/essay';

export interface EssaySubmissionResult {
  readonly essay: Essay;
  /**
   * Whenever true, the adapter calling this must (re)set the session
   * cookie to `essay.sessionId` — see `resolveGuestSession`'s own
   * `reissued` doc comment for the full case list. False for both an
   * ordinary first write and a returning guest's later one; the cookie
   * already in the browser names the right session either way.
   */
  readonly reissued: boolean;
}

/**
 * Resolves the caller's guest session from the raw cookie value the
 * adapter read (`undefined` if there wasn't one) and persists `content`
 * under it.
 *
 * `content` is taken as-is — already validated (shape, and the KAN-14
 * safety cap; KAN-15's real length rules land here eventually) by the
 * adapter's own request-schema check before this is ever called. This
 * function does not re-validate it, the same division of labour
 * `resolveGuestSession` itself has with its callers for the cookie value.
 */
export async function submitEssay(
  rawCookieValue: string | undefined,
  content: string,
): Promise<EssaySubmissionResult> {
  const { actor, reissued } = await resolveGuestSession(rawCookieValue);
  const essay = await createEssay(actor, content);
  return { essay, reissued };
}
