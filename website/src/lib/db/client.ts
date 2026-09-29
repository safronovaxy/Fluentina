import 'server-only';

/**
 * The one place the database client is constructed. Everything else in
 * `lib/db` imports `db` from here; nothing outside `lib/db` may import this
 * module at all — `eslint.config.js` enforces that with `no-restricted-imports`
 * (domain goes through repositories, adapters go through domain).
 *
 * node-postgres driver, per the architecture decision to use Drizzle with
 * drizzle-kit and `node-postgres` (not e.g. `postgres.js` or a serverless
 * driver) — see CONTRIBUTING.md / Architecture Decisions.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { installQueryErrorSanitiser } from './query-error-sanitiser';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — see website/.env.example');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Provisional cap, not a tuned value — pending ADR-16 (connection-pool
  // sizing), which Irina has not reviewed yet. Chosen only to guarantee some
  // explicit bound exists rather than the driver's own default; revisit once
  // that ADR lands.
  max: 10,
});

// KAN-36: installed here, at the one place `db` is constructed, so importing
// `db` at all is what turns it on — no query author opts in. Must run before
// any query does; see query-error-sanitiser.ts for what it scrubs and why the
// driver's own errors cannot be logged as-is. Deliberately NOT `logger: true`
// on `drizzle()` below either: Drizzle's query logger prints every bound
// parameter, the same leak by another route.
installQueryErrorSanitiser();

// KAN-43: `Pool` is an EventEmitter, and an error on an IDLE client (Cloud SQL
// reaping a connection, a failover or maintenance restart, a network blip) has
// no query promise to travel down, so `pg` emits it as `'error'` on the pool.
// Node throws an unhandled `'error'` event, which is an uncaught exception and
// ends the process — on Cloud Run, an unexplained restart. `pg` has already
// discarded the dead client by the time this fires, so logging is the whole
// job; the next `pool.query` opens a fresh connection.
//
// Attached before `drizzle(pool)` below so there is no window in which the
// pool exists without one. NOT an empty handler: one line per event goes out
// in the same one-JSON-object-per-line idiom as `rate-limit.ts` and
// `grading/telemetry.ts`, with the pool's own counts, because a run of these
// is the evidence ADR-16 (pool sizing / Cloud SQL connection limits) is
// waiting for.
//
// METADATA ONLY, by allowlist. `err.message` is never copied, and neither is
// `stack` or any other property: `pg` builds its connection errors from the
// configuration, and a connection string (`postgres://user:PASSWORD@host/db`)
// can end up in a message. Each field kept is a short, fixed-shape token
// (SQLSTATE, libuv errno name, syscall) and is dropped if it does not match.
// This is the pool-level counterpart to `query-error-sanitiser.ts`, which
// covers errors that reach a QUERY's promise and never sees these.
const SQLSTATE_OR_ERRNO_NAME = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,30})$/;
const SYSCALL_NAME = /^[a-z_]{2,20}$/;
const ERROR_CLASS_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

function shortToken(value: unknown, shape: RegExp): string | null {
  return typeof value === 'string' && shape.test(value) ? value : null;
}

function logIdleClientError(err: unknown): void {
  const e = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  console.warn(
    JSON.stringify({
      severity: 'WARNING',
      event: 'db_pool_idle_client_error',
      timestamp: new Date().toISOString(),
      errorName: shortToken(e.name, ERROR_CLASS_NAME),
      errorCode: shortToken(e.code, SQLSTATE_OR_ERRNO_NAME),
      syscall: shortToken(e.syscall, SYSCALL_NAME),
      poolMax: pool.options.max ?? null,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    }),
  );
}

pool.on('error', logIdleClientError);

export const db = drizzle(pool, { schema });

// Exposed only so tests inside lib/db can tear the pool down after a suite
// runs (otherwise Vitest hangs on an open TCP handle); not part of the
// repository API adapters or domain code ever call.
export async function closePool(): Promise<void> {
  await pool.end();
}
