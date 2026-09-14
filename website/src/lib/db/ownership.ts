import 'server-only';

/**
 * KAN-10: the row-level ownership rule, in exactly one place.
 *
 * A guest owns a row only while it is unattached (`user_id IS NULL`). That
 * "unattached" conjunct *is* the post-conversion cutover rule from the
 * acceptance criteria: once conversion attaches a row to an account, the
 * guest's old session id permanently stops authorising reads of it — even
 * if that session cookie is still sitting in someone's browser. There is no
 * separate "revoke the old session" step; it falls straight out of this
 * predicate.
 *
 * A registered user owns a row by `user_id` match, full stop.
 *
 * Every function in `lib/db` that reads or mutates an owned row calls this
 * with the caller's `Actor` and gets back a condition to `.where()` — never
 * a bare boolean, never hand-rolled `eq`/`and` at the call site, so this is
 * the one file to audit for the ownership rule and the one file to change
 * if it ever needs to.
 *
 * --- Why the return type is `SQL`, never `SQL | undefined` ---
 *
 * Drizzle's own `and()` (and `or()`) is typed `T | undefined`: given zero
 * truthy conditions it returns `undefined`. Passing `undefined` to
 * `.where()` is not a type error and not a runtime error — Drizzle treats
 * "no condition" as "no filter" and the query returns every row in the
 * table. That is a silent full-table read: no exception, no failing test,
 * exactly the failure mode this story exists to prevent.
 *
 * `buildOwnershipCondition` is the one seam where that could happen (if a
 * future edit ever left it building an empty condition list), so it is the
 * one place that turns "and() came back falsy" into a thrown error instead
 * of a value that quietly reaches `.where()`. `ownedBy`'s return type is the
 * non-optional `SQL`, so a caller can never receive `undefined` from this
 * module even if they forgot to check.
 */
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { OwnerActor } from '@/lib/contracts/actor';

export interface OwnedColumns {
  /** The column holding the guest session id that originated the row. */
  readonly sessionId: PgColumn;
  /** The nullable column holding the owning user id, once attached. */
  readonly userId: PgColumn;
}

/**
 * Builds a non-optional ownership condition from a list of sub-conditions,
 * throwing rather than ever handing back `undefined`. Kept separate from
 * `ownedBy` so the one dangerous line — the call to Drizzle's `and()` — is
 * isolated and directly unit-testable against the exact input (an empty
 * array) that would otherwise reproduce the silent full-table read.
 *
 * Exported for that direct test (see ownership.test.ts), not because
 * anything outside this module should call it — `ownedBy` is the public
 * entry point for every actual query.
 */
export function buildOwnershipCondition(conditions: readonly (SQL | undefined)[]): SQL {
  const condition = and(...conditions);
  if (!condition) {
    throw new Error(
      'ownership condition collapsed to undefined — refusing to pass that to .where(), ' +
        'which would silently match every row in the table',
    );
  }
  return condition;
}

/**
 * Row-level ownership, as a `.where()` condition. Takes an `OwnerActor` —
 * never a plain `Actor` — so a `SystemActor` cannot be passed here at all;
 * see the type-level exclusion asserted in `ownership.typecheck.ts`. System
 * code that genuinely needs to bypass ownership calls a separately named
 * `*Unscoped` function (see lib/db/essays.ts).
 */
export function ownedBy(actor: OwnerActor, columns: OwnedColumns): SQL {
  if (actor.kind === 'guest') {
    return buildOwnershipCondition([
      eq(columns.sessionId, actor.sessionId),
      isNull(columns.userId),
    ]);
  }
  return buildOwnershipCondition([eq(columns.userId, actor.userId)]);
}
