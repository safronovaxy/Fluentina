/**
 * Test-only fixture helpers for the KAN-10 data-layer suite. `resetDatabase`
 * is a raw TRUNCATE — the kind of unscoped query `lib/db`'s repositories
 * deliberately never expose — so it lives here, in `src/test`, not inside
 * `lib/db` itself.
 *
 * It used to live in `lib/db/test-helpers.ts`. Review flagged that as a real
 * hole, not just an odd location: the layering lint blocks adapters from
 * importing `lib/db` at all, but only blocks the domain layer from the raw
 * client (`@/lib/db/client`) — never from the rest of `lib/db` — so a plain
 * export sitting inside `lib/db` was reachable from domain code, which could
 * import it and wipe every owned table. Moving it out of `lib/db` entirely,
 * and adding `@/test`/`@/test/**` to the restricted-import groups for
 * contracts, domain and adapters (see eslint.config.js), closes that: no
 * production module graph can reach this file at all, from any layer.
 */
import { sql } from 'drizzle-orm';
import { db, closePool } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

/**
 * Refuses to run `resetDatabase` against anything but a local database.
 * `docker-compose.yml` moved the local Postgres off port 5432 specifically
 * because that is where `cloud-sql-proxy` conventionally listens — so a
 * developer whose `.env.local` happens to point through a proxy (forwarding
 * to the real, shared Cloud SQL instance) would otherwise have every table
 * this fixture touches unconditionally truncated by running the test suite.
 * Checked on hostname only, not port: local dev uses 55432, CI's Postgres
 * service container uses 5432, and both are `localhost`.
 */
function assertLocalDatabase(): void {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(
      `resetDatabase refuses to TRUNCATE against host "${url.hostname}" — DATABASE_URL must point at ` +
        'a local database ("localhost"/"127.0.0.1"), never anything reachable through a proxy to ' +
        'production (e.g. cloud-sql-proxy). Point DATABASE_URL at the local Postgres from ' +
        '`docker compose up -d db` (see website/.env.example) before running the test suite.',
    );
  }
}

/** Wipes every KAN-10 table between tests. Cascades handle ordering. */
export async function resetDatabase(): Promise<void> {
  assertLocalDatabase();
  await db.execute(sql`TRUNCATE TABLE fluentina.essays, fluentina.guest_sessions, fluentina.users RESTART IDENTITY CASCADE`);
}

/**
 * Inserts a bare row into `users` and returns its id, so a test's
 * `UserActor` fixture points at a real FK target — `essays.user_id` and
 * `guest_sessions.user_id` both reference `users.id`, so a `UserActor`
 * built from a bare `randomUUID()` fails conversion with a foreign-key
 * violation, correctly: a registered-account id has to actually exist.
 * Registration itself (email, auth, etc.) is a separate story; this is
 * fixture-only plumbing for a column this story's FKs require, not a
 * repository export real code calls.
 */
export async function createTestUser(): Promise<string> {
  const [row] = await db.insert(users).values({}).returning({ id: users.id });
  return row.id;
}

export { closePool };
