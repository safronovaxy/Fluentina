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
 * to the scoped one instead (see lib/db/essays.ts, lib/db/guest-sessions.ts),
 * so every deliberate bypass of ownership is findable by grepping "Unscoped".
 */
import { z } from 'zod';

// The bearer session id is 128 bits from crypto.randomBytes(16), hex-encoded
// — 32 lowercase hex characters. Validated here so any boundary that accepts
// one from the outside world (a cookie, once KAN-9's session issuance lands)
// can reject a malformed value before it ever reaches a query.
export const guestSessionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, 'must be a 32-character lowercase hex string (128 bits)');

export type GuestSessionId = z.infer<typeof guestSessionIdSchema>;

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
