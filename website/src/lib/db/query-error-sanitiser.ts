// No `import 'server-only'` here, for the same reason schema.ts and
// postgres-version.ts omit it: this module is loaded by scripts/migrate.ts,
// which runs in plain Node outside the Next.js bundler, where that marker
// throws unconditionally (measured: importing this file under `tsx` fails
// with "This module cannot be imported from a Client Component module").
// It holds no queries, no client and no secrets, and `client.ts` — the
// module that actually builds the app's connection — keeps the marker.

/**
 * KAN-36 — the query-error sanitiser: no error carrying bound query
 * parameters, or values echoed back from a row, ever leaves `lib/db`.
 *
 * WHY THIS EXISTS. When a query fails, Drizzle wraps the driver's error in a
 * `DrizzleQueryError` whose MESSAGE is `Failed query: <sql>\nparams: <every
 * bound value>`, and which also carries the same values as a `.params` array.
 * Underneath, on `.cause`, `pg`'s own error carries `detail` — for a unique or
 * foreign-key violation, `Key (col)=(<the value>) ...`, and for a not-null
 * violation, `Failing row contains (<the whole row>)` — and, for some data
 * errors, the offending value inside its `message`
 * (`invalid input syntax for type uuid: "<value>"`). Nothing in this codebase
 * catches a failed essay write, so the whole tree reaches the framework's
 * default error handling, which prints it (`util.inspect`, so every
 * enumerable property, not just `message`) to stderr — and on Cloud Run
 * stderr is Cloud Logging. The result: a failed insert writes the guest's
 * entire essay, or their session credential, into the log store. This
 * violates the rule that operational logs carry metadata only, never essay
 * text (BR-7.x, the same rule KAN-24 holds grading telemetry to).
 *
 * WHY HERE, NOT PER CALL SITE. KAN-25 fixed the rate-limit counter with a
 * catch-and-rethrow at that one call site. That closes one table; the next
 * table (`grading_jobs.raw_input`, which holds the prompt sent to the
 * provider, essay included) would have re-opened it, and so would every one
 * after. A control that depends on each author remembering to add it is the
 * shape ADR-14 rejected. So this sits at the one function every query the
 * driver runs passes through — `queryWithCache`, below — and is installed by
 * `client.ts` at import time, i.e. by the same act of importing `db` at all,
 * and by `scripts/migrate.ts`, the one other place that builds its own
 * Drizzle pg client. There is no opt-in. (Nothing ENFORCES the second half:
 * `scripts/**` is outside the ESLint `pg`/`drizzle-orm` restriction, which is
 * scoped to `src/**`. A new script that builds a client must call
 * `installQueryErrorSanitiser()` itself.)
 *
 * WHAT IT KEEPS. An error that says nothing is its own problem: someone
 * debugging a failed insert at 2am needs to know WHICH constraint. So the
 * sanitised error keeps the statement (`query`, with its `$1, $2` placeholders
 * — the shape, not the values), the SQLSTATE `code`, `severity`, and the
 * catalogue names `schema`/`table`/`column`/`constraint`/`dataType`, plus
 * `routine` and `position`. Everything else is dropped.
 *
 * `hint` is dropped with the rest. Dropping it wholesale was considered and
 * found to cost something real: the hints worth having are class 42
 * developer-error cases (`42703` "Perhaps you meant to reference the
 * column ...", `42P10` on a missing `ON CONFLICT` index) whose `hint` names
 * catalogue objects and never a parameter value. It stays off the allowlist
 * anyway, because a field is kept by being named and nobody has yet audited
 * every SQLSTATE that sets one — so if a class 42 hint is ever wanted, add
 * it deliberately, for class 42 only.
 *
 * ALLOWLIST, NOT DENYLIST. Fields are kept by name; anything not named is
 * deleted. A denylist ("strip `detail` and `params`") would silently
 * re-open the leak the day a driver upgrade adds a field that echoes a value.
 * For the same reason the driver's own `message` is NOT kept for a
 * Postgres-originated error: it is free text, and `invalid input syntax for
 * type uuid: "<value>"` is exactly the shape that echoes a bound value back.
 * The message is rebuilt from the kept fields instead. Errors with no
 * SQLSTATE that are POSITIVELY identified as libuv/network errors (`syscall`
 * or a numeric `errno` — a refused connection, a connect timeout; nothing
 * that ever saw a parameter) keep their message, since `connect ECONNREFUSED
 * 127.0.0.1:5432` is precisely the diagnostic worth having.
 *
 * `message` is allowlisted like every other field: an error that is NEITHER
 * Drizzle-shaped, pg-shaped nor libuv-shaped gets a fixed message. That
 * branch used to keep `message` verbatim, which made it the one fail-open
 * path — a Drizzle minor that changed `query` to the `{ sql, params }`
 * object it stores internally, or renamed `params`, would have made
 * `isDrizzleQueryError` false while the field loop still deleted
 * `query`/`params`, so the sanitiser would have LOOKED as if it worked while
 * `message` and the head of `stack` still read `Failed query: <sql>\nparams:
 * <the whole essay>`. The import-time assertion below guards method removal,
 * not error-shape drift; this is what guards the latter.
 *
 * WHAT IT MUST NOT DO. It never swallows or replaces control flow: the SAME
 * error object is rethrown (mutated in place), so `instanceof
 * DrizzleQueryError` and `err.cause.code === '23505'`
 * (`lib/domain/guest-session.ts::isUniqueViolation`) keep working, and a
 * failed transaction still rolls back exactly as before. If sanitising itself
 * ever throws, it fails CLOSED — a fixed, detail-free error — never open.
 */
import { NodePgPreparedQuery } from 'drizzle-orm/node-postgres';

const REDACTED = '[redacted]';
const MAX_CAUSE_DEPTH = 5;

/** Postgres-originated errors: kept by name, everything else deleted. */
const PG_KEEP: ReadonlySet<string> = new Set([
  'name',
  'severity',
  'code',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'routine',
  'position',
]);

/** libuv / network errors (no SQLSTATE, positively identified): kept by name, everything else deleted. */
const SYSTEM_KEEP: ReadonlySet<string> = new Set(['name', 'code', 'errno', 'syscall', 'address', 'port']);

/** Anything unrecognised: only its name survives, and its message is replaced by `UNRECOGNISED_MESSAGE`. */
const UNRECOGNISED_KEEP: ReadonlySet<string> = new Set(['name']);

const UNRECOGNISED_MESSAGE =
  'database error of an unrecognised shape (details withheld: lib/db/query-error-sanitiser.ts could not identify it)';

/**
 * The Drizzle wrapper itself. `query` is the statement with `$n` placeholders
 * — its shape, deliberately kept.
 */
const DRIZZLE_KEEP: ReadonlySet<string> = new Set(['name', 'query']);

/**
 * Human-readable names for the SQLSTATEs this application can plausibly hit.
 * Static strings, so safe to print. Not exhaustive on purpose: an unlisted
 * code still prints its number, which is what anyone searching the Postgres
 * docs needs anyway.
 */
const SQLSTATE_NAMES: Readonly<Record<string, string>> = {
  '08006': 'connection_failure',
  '22001': 'string_data_right_truncation',
  '22021': 'character_not_in_repertoire',
  '22P02': 'invalid_text_representation',
  '23502': 'not_null_violation',
  '23503': 'foreign_key_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '40001': 'serialization_failure',
  '40P01': 'deadlock_detected',
  '42703': 'undefined_column',
  '42P01': 'undefined_table',
  '53300': 'too_many_connections',
  '55P03': 'lock_not_available',
  '57014': 'query_canceled',
  '57P01': 'admin_shutdown',
};

const scrubbed = new WeakSet<object>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `pg`'s `DatabaseError` — the only error type that carries a SQLSTATE and a severity. */
function isPostgresError(err: Record<string, unknown>): boolean {
  return typeof err.severity === 'string' && typeof err.code === 'string';
}

/** Drizzle's own `DrizzleQueryError`, recognised structurally (see the install comment on why not `instanceof`). */
function isDrizzleQueryError(err: Record<string, unknown>): boolean {
  return typeof err.query === 'string' && Array.isArray(err.params);
}

/**
 * A libuv / network error (`ECONNREFUSED`, `ETIMEDOUT`, ...): Node sets a
 * `syscall` string and a numeric `errno` on these, and they never saw a
 * bound parameter. The ONLY shape whose own message is kept.
 */
function isSystemError(err: Record<string, unknown>): boolean {
  return typeof err.syscall === 'string' || typeof err.errno === 'number';
}

function describePostgresError(err: Record<string, unknown>): string {
  const code = String(err.code);
  const conditionName = SQLSTATE_NAMES[code];
  const parts = [`postgres ${String(err.severity)} ${code}${conditionName ? ` (${conditionName})` : ''}`];
  const location = [
    typeof err.schema === 'string' && typeof err.table === 'string'
      ? `table "${err.schema}.${err.table}"`
      : typeof err.table === 'string'
        ? `table "${err.table}"`
        : undefined,
    typeof err.column === 'string' ? `column "${err.column}"` : undefined,
    typeof err.dataType === 'string' ? `type "${err.dataType}"` : undefined,
    typeof err.constraint === 'string' ? `constraint "${err.constraint}"` : undefined,
  ].filter(Boolean);
  if (location.length > 0) parts.push(location.join(', '));
  return parts.join(': ');
}

/**
 * Replaces `err.message`, and the copy of it V8 froze into the head of
 * `err.stack` when the error was constructed — Node's default handler prints
 * `stack`, not `message`, so rewriting only the latter would leave the whole
 * leak in place. The original frames are kept (where in OUR code the query
 * ran is diagnostic value). The old message is located in the stack by
 * searching for it rather than by looking for the first `    at ` line,
 * because the message can itself be multi-line and attacker-controlled (an
 * essay containing a line that starts with `    at `); if it cannot be
 * located the frames are dropped rather than guessed at.
 */
function rewriteMessage(err: Record<string, unknown>, newMessage: string): void {
  const oldMessage = typeof err.message === 'string' ? err.message : '';
  const oldStack = typeof err.stack === 'string' ? err.stack : '';
  const at = oldMessage.length > 0 ? oldStack.indexOf(oldMessage) : -1;
  const prefix = at >= 0 && at <= 200 ? oldStack.slice(0, at) : `${String(err.name ?? 'Error')}: `;
  const frames = at >= 0 && at <= 200 ? oldStack.slice(at + oldMessage.length) : '';
  err.message = newMessage;
  err.stack = `${prefix}${newMessage}${frames}`;
}

function scrubInPlace(err: unknown, depth: number): void {
  if (!isObject(err) || scrubbed.has(err)) return;
  scrubbed.add(err);

  const drizzle = isDrizzleQueryError(err);
  const postgres = !drizzle && isPostgresError(err);
  const system = !drizzle && !postgres && isSystemError(err);
  // Fail closed: the last branch is "unrecognised", never "keep everything".
  const keep = drizzle ? DRIZZLE_KEEP : postgres ? PG_KEEP : system ? SYSTEM_KEEP : UNRECOGNISED_KEEP;

  // Computed BEFORE any deletion: they read the fields about to be dropped.
  // Only a positively identified libuv error keeps its own message.
  const newMessage = drizzle
    ? `Failed query: ${String(err.query)}\nparams: [${(err.params as unknown[]).length} value(s) ${REDACTED}]`
    : postgres
      ? describePostgresError(err)
      : system
        ? undefined
        : UNRECOGNISED_MESSAGE;
  const redactedParams = drizzle ? (err.params as unknown[]).map(() => REDACTED) : undefined;
  const cause = err.cause;

  for (const key of Object.getOwnPropertyNames(err)) {
    if (key === 'message' || key === 'stack' || key === 'cause') continue;
    // A kept field the driver left `undefined` (pg sets every optional field
    // as an own property) is dropped too: it says nothing, and it would
    // otherwise print as `column: undefined` noise in every logged error.
    if (keep.has(key) && err[key] !== undefined) continue;
    delete err[key];
  }
  if (redactedParams) err.params = redactedParams;
  if (newMessage !== undefined) rewriteMessage(err, newMessage);

  if (cause !== undefined) {
    if (depth < MAX_CAUSE_DEPTH) {
      scrubInPlace(cause, depth + 1);
    } else {
      delete err.cause;
    }
  }
}

/**
 * Scrubs `error` in place and returns it — the SAME object, so callers'
 * `instanceof` / `.cause.code` checks are unaffected. Never throws: if the
 * scrub itself fails (a frozen error object, say), it returns a fixed,
 * detail-free replacement rather than the unscrubbed original.
 */
export function sanitiseQueryError(error: unknown): unknown {
  if (!isObject(error)) return error;
  try {
    scrubInPlace(error, 0);
    return error;
  } catch {
    return new Error('database query failed (error details withheld: the error sanitiser could not scrub them)');
  }
}

type QueryWithCache = (this: unknown, ...args: unknown[]) => Promise<unknown>;

const INSTALLED = Symbol.for('fluentina.queryErrorSanitiser');

/**
 * Wraps `queryWithCache`, the one method on Drizzle's prepared-query base
 * class that every execution path funnels through — `db.insert/select/
 * update/delete`, `db.execute(sql...)`, the relational query API, prepared
 * statements, and a transaction's own `begin`/`commit`/`rollback`. Every
 * `catch` in it constructs the `DrizzleQueryError` with the bound params, so
 * an error leaving it is the earliest point at which the leak exists and the
 * last at which any caller could have observed it.
 *
 * It is a Drizzle-internal method (`@internal` in its typings), so this
 * couples to the pinned `drizzle-orm` minor. Two things keep that honest:
 * missing it throws at import time (fail closed — the app does not boot
 * unprotected), and `query-error-sanitiser.test.ts` fails a real insert
 * against a real database, so an upgrade that renames the method or routes
 * around it turns CI red rather than silently un-protecting production.
 *
 * Patched on `NodePgPreparedQuery.prototype` from `drizzle-orm/node-postgres`
 * — the same entry point `client.ts` builds its `drizzle()` from — not on the
 * `PgPreparedQuery` base from `drizzle-orm/pg-core`, so it is guaranteed to
 * be the very class the app's queries instantiate even if the package is
 * ever loaded in both its ESM and CJS builds. Idempotent, including across
 * module reloads in dev.
 */
export function installQueryErrorSanitiser(): void {
  const prototype = NodePgPreparedQuery.prototype as unknown as { queryWithCache?: QueryWithCache };
  const original = prototype.queryWithCache;
  if (typeof original !== 'function') {
    throw new Error(
      'drizzle-orm no longer exposes queryWithCache (NodePgPreparedQuery.prototype, inherited from ' +
        'PgPreparedQuery.prototype) — the KAN-36 query-error sanitiser cannot ' +
        'be installed, and refusing to run without it (failed query errors would carry bound parameters). ' +
        'See lib/db/query-error-sanitiser.ts.',
    );
  }
  if ((original as unknown as Record<symbol, unknown>)[INSTALLED]) return;

  const wrapped: QueryWithCache = async function (this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (error) {
      throw sanitiseQueryError(error);
    }
  };
  (wrapped as unknown as Record<symbol, unknown>)[INSTALLED] = true;
  Object.defineProperty(prototype, 'queryWithCache', { value: wrapped, configurable: true, writable: true });
}
