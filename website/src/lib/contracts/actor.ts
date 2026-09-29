/**
 * KAN-10: who is asking.
 *
 * `Actor` is deliberately the only thing an ownership check is ever allowed
 * to take. There is no "trust me" escape hatch alongside it — see
 * `lib/db/ownership.ts`, which is the one place that turns an Actor into a
 * SQL condition, and `lib/db`'s repositories, which take an Actor as a
 * required first parameter on every function that touches an owned row.
 *
 * Three kinds of actor exist:
 * - a guest, identified by a bearer session id (see `session-id.ts` in
 *   `lib/domain` for how that id is generated);
 * - a registered user, identified by their user id;
 * - the system, for background jobs (e.g. a grading worker) that need to
 *   read a row without an end-user driving the request.
 *
 * `OwnerActor` excludes `SystemActor` on purpose, at the type level: "system"
 * means ownership does not apply, not "no filter". A function that enforces
 * row ownership takes `OwnerActor`, so a `SystemActor` is a compile error at
 * the call site — it cannot silently take the "owns everything" branch of an
 * if/else. System code calls the separately named `*Unscoped` function next
 * to the scoped one instead (see lib/db/essays.ts), so every deliberate
 * bypass of ownership is findable by grepping "Unscoped".
 */
import { z } from 'zod';

// The bearer session id is 128 bits from crypto.randomBytes(16), hex-encoded
// — 32 lowercase hex characters. Validated here so any boundary that accepts
// one from the outside world (a cookie, once KAN-9's session issuance lands)
// can reject a malformed value before it ever reaches a query.
//
// `.brand<'GuestSessionId'>()` matters as much as the regex does. Without
// it, `z.infer` on a regex-refined string schema is still plain `string` —
// any string type-checks as a `GuestSessionId`, so a raw, unvalidated cookie
// value could be assigned straight into a `GuestActor` with no compiler
// complaint and no parse ever running. The brand makes that assignment a
// type error: the only way to produce a `GuestSessionId` is through
// `guestSessionIdSchema.parse`/`.safeParse`, so every value that reaches
// `createGuestSession` (the function that inserts it as a primary key) has
// already been through the regex — closing the session-fixation route where
// someone plants a cookie value and gets to choose their own session id.
export const guestSessionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, 'must be a 32-character lowercase hex string (128 bits)')
  .brand<'GuestSessionId'>();

export type GuestSessionId = z.infer<typeof guestSessionIdSchema>;

// KAN-20: a registered user's session token — the value in the
// `__Host-fluentina_session` cookie — is 256 bits (32 bytes, hex-encoded to
// 64 lowercase hex characters), double the guest id's 128. The guest id was
// sized for one anonymous essay; this one unlocks an account.
//
// Two brands, not one, and that is deliberate: the raw token and its SHA-256
// hash are both 64 lowercase hex characters, so without distinct brands a
// value of one shape type-checks as the other. `sessions.id` stores the HASH
// (see lib/db/sessions.ts) and never the token, so passing a raw cookie
// value where a hash is expected — which would store the live credential in
// the table, the exact thing the hashing exists to prevent — is a compile
// error here. The only ways to produce either value are these schemas'
// `parse`/`safeParse` and `lib/domain/registered-session-token.ts`.
export const registeredSessionTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a 64-character lowercase hex string (256 bits)')
  .brand<'RegisteredSessionToken'>();

export type RegisteredSessionToken = z.infer<typeof registeredSessionTokenSchema>;

export const registeredSessionTokenHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a 64-character lowercase hex SHA-256 digest')
  .brand<'RegisteredSessionTokenHash'>();

export type RegisteredSessionTokenHash = z.infer<typeof registeredSessionTokenHashSchema>;

export interface GuestActor {
  readonly kind: 'guest';
  readonly sessionId: GuestSessionId;
}

export interface UserActor {
  readonly kind: 'user';
  readonly userId: string;
}

export interface SystemActor {
  readonly kind: 'system';
  /** Job name, for grading-log metadata only — never logged alongside essay text or an email. */
  readonly job: string;
}

/** The only two actor kinds an ownership-enforcing function may accept. */
export type OwnerActor = GuestActor | UserActor;

export type Actor = OwnerActor | SystemActor;
