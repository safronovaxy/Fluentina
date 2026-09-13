import 'server-only';

/**
 * Test-only fixture helpers. `resetDatabase` is a raw TRUNCATE — the kind of
 * unscoped query `lib/db`'s repositories deliberately never expose — but
 * this is fixture setup for the test suite, not a production read/write
 * path, so it lives outside the repository files and is imported only by
 * `*.test.ts` files in this directory.
 */
import { sql } from 'drizzle-orm';
import { db, closePool } from './client';
import { users } from './schema';

/** Wipes every KAN-10 table between tests. Cascades handle ordering. */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app.essays, app.guest_sessions, app.users RESTART IDENTITY CASCADE`);
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
