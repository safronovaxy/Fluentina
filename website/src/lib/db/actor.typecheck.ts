/**
 * Compile-only assertions (see `lib/db/ownership.typecheck.ts` for the style):
 * `tsc --noEmit` is the only runner, and a `@ts-expect-error` that stops
 * firing is the failure.
 *
 * KAN-20: the raw session token and its SHA-256 are both 64 lowercase hex
 * characters, so at runtime they are indistinguishable. The two brands are the
 * only thing stopping a raw cookie value being handed to the `sessions`
 * repository as if it were the hash — which would write the live credential
 * into `sessions.id`, the exact thing hashing it exists to prevent.
 *
 * Lives in `lib/db`, next to `ownership.typecheck.ts`, not in `lib/contracts`:
 * what it asserts is about the repository's signatures, and it imports the
 * repositories — nothing in `lib/contracts` imports `lib/db`.
 */
import type { RegisteredSessionToken, RegisteredSessionTokenHash, UserActor } from '@/lib/contracts/actor';
import { deleteSession, findLiveSessionUserId } from './sessions';
import { findUserForLogin } from './users';
import { hashRegisteredSessionToken } from '@/lib/domain/registered-session-token';
import { checkLoginRateLimit } from '@/lib/domain/rate-limit';

declare const rawString: string;
declare const token: RegisteredSessionToken;
declare const hash: RegisteredSessionTokenHash;
declare const user: UserActor;

// @ts-expect-error — a plain string is not a token hash.
findLiveSessionUserId(rawString);

// @ts-expect-error — a raw session TOKEN must not be accepted where the HASH belongs.
findLiveSessionUserId(token);

// @ts-expect-error — the same, for the actor-scoped delete.
deleteSession(user, token);

// @ts-expect-error — and the hash is not a token: hashing takes a token.
hashRegisteredSessionToken(hash);

// @ts-expect-error — an email straight off the wire is not a NormalisedEmail.
findUserForLogin('Someone@Example.com');

// @ts-expect-error — the login rate limiter keys on the normalised email only.
checkLoginRateLimit('Someone@Example.com', null);

// Sanity: the real values type-check in the same positions.
findLiveSessionUserId(hash);
deleteSession(user, hash);
hashRegisteredSessionToken(token);
