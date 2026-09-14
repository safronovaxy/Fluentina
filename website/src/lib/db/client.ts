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

export const db = drizzle(pool, { schema });

// Exposed only so tests inside lib/db can tear the pool down after a suite
// runs (otherwise Vitest hangs on an open TCP handle); not part of the
// repository API adapters or domain code ever call.
export async function closePool(): Promise<void> {
  await pool.end();
}
