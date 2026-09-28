/** @vitest-environment node */
import { afterAll, describe, expect, it } from 'vitest';
import { format, inspect } from 'node:util';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { NodePgPreparedQuery } from 'drizzle-orm/node-postgres';
import { runMigration } from '../../../scripts/migrate';

/**
 * KAN-36. `scripts/migrate.ts` builds its own Drizzle client and never imports
 * `client.ts`, where the app installs the query-error sanitiser; its
 * `main().catch(console.error)` prints whatever it is given. `scripts/**` is
 * outside the ESLint `pg`/`drizzle-orm` restriction (scoped to `src/**`), so
 * nothing else keeps a second client from being built unprotected — this test
 * is what pins THIS one.
 *
 * Deliberately imports nothing that imports `client.ts` (not `db-fixtures`
 * either): if it did, the sanitiser would already be installed by that import
 * and this test would pass with the call removed from migrate.ts.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

describe('scripts/migrate.ts installs the KAN-36 query-error sanitiser', () => {
  it('importing the script alone patches the prepared-query class', () => {
    const patched = (NodePgPreparedQuery.prototype as unknown as { queryWithCache?: unknown }).queryWithCache;

    expect((patched as Record<symbol, unknown>)[Symbol.for('fluentina.queryErrorSanitiser')]).toBe(true);
  });

  it('a failing statement run through the client the script builds carries no bound value', async () => {
    const secret = 'MIGRATESECRET-Sehr geehrte Damen und Herren';
    let thrown: unknown;
    try {
      await runMigration(pool, async (db) => {
        await db.execute(sql`select ${secret}::integer`);
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown, 'the statement must fail for this test to mean anything').toBeInstanceOf(Error);
    const loggable = [inspect(thrown, { depth: null }), format('%s', thrown), String((thrown as Error).stack)].join('\n');
    expect(loggable).not.toContain('MIGRATESECRET');
    expect(loggable).toContain('22P02');
  });
});
