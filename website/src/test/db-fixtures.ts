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

/** Wipes every KAN-10 table between tests. Cascades handle ordering. */
export async function resetDatabase(): Promise<void> {
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
