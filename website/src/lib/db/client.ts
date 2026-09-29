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
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
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

export const db = drizzle(pool, { schema });

// Exposed only so tests inside lib/db can tear the pool down after a suite
// runs (otherwise Vitest hangs on an open TCP handle); not part of the
// repository API adapters or domain code ever call.
export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Anything a query can run on: the pool-backed `db`, or the transaction handle
 * `db.transaction` passes to its callback. `PgTransaction` extends
 * `PgDatabase`, so one parameter type accepts both.
 *
 * KAN-20: exists so a repository function that must take part in a caller's
 * transaction (`convertGuestSessionToUserWithin`, `insertSessionWithin`) can
 * say so in its signature. Calling `db.transaction` again from inside another
 * transaction does NOT nest — Drizzle checks out a second pooled connection
 * and runs a separate, independent transaction — so a function that opens its
 * own cannot be composed into a larger atomic unit. The `*Within` variants
 * take one of these instead and never open a transaction themselves.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
