import 'server-only';

/**
 * The registered-user half of "who is asking" — the seam KAN-20 (Auth.js,
 * database sessions) fills in.
 *
 * Returns `null` today because no registered session exists to read: there is
 * no sign-in yet. It is its own module, not a local function of
 * `owner-actor.ts`, so that (a) KAN-20 replaces one body in production code,
 * and (b) a test can stand a registered session in front of the resolver — the
 * order in `resolveOwnerActor` matters and is only observable while a
 * registered session can be made to exist.
 *
 * The cost of (b) for KAN-20: exactly three test files `vi.mock` this module
 * and keep returning their stub after the real `sessions` lookup exists, so
 * all three stay green whether or not that lookup works —
 * `app/api/essays/[id]/grading/route.test.ts`,
 * `app/[locale]/(guest)/practice/preview/page.test.tsx` and
 * `lib/domain/owner-actor.test.ts`. KAN-20 must cover the real lookup in its
 * own tests, not lean on those.
 *
 * `async` because KAN-20's version is a `sessions` row lookup.
 */
import type { UserActor } from '@/lib/contracts/actor';

export async function resolveRegisteredSession(readCookie: (name: string) => string | undefined): Promise<UserActor | null> {
  void readCookie;
  return null;
}
