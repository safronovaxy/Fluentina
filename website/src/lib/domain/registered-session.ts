import 'server-only';

/**
 * The registered-user half of "who is asking" — the seam KAN-20 (Auth.js,
 * database sessions) fills in.
 *
 * Returns `null` today because no registered session exists to read: there is
 * no sign-in yet. It is its own module, not a local function of
 * `owner-actor.ts`, so that (a) KAN-20 replaces one body and nothing else, and
 * (b) a test can stand a registered session in front of the resolver — the
 * order in `resolveOwnerActor` matters and is only observable while a
 * registered session can be made to exist.
 *
 * `async` because KAN-20's version is a `sessions` row lookup.
 */
import type { UserActor } from '@/lib/contracts/actor';

export async function resolveRegisteredSession(readCookie: (name: string) => string | undefined): Promise<UserActor | null> {
  void readCookie;
  return null;
}
