/**
 * Deliberately no `import 'server-only'` here, unlike every other module in
 * this directory. `drizzle-kit generate` (and `introspect`/`push`) loads
 * this file directly in plain Node to read the table shapes — it is not run
 * through Next's bundler, so the `server-only` marker's export-condition
 * check has nothing to negotiate against and throws unconditionally,
 * breaking migration generation outright. This file is pure declarative
 * table shape with no queries, no client, and no secret — the thing
 * `server-only` protects against (this code ending up in a browser bundle)
 * is guarded here by the ESLint `no-restricted-imports` boundary instead
 * (adapters may not import `@/lib/db/*` at all, this file included).
 * Flagged for Solution Architect review — the ADR's "every module in
 * lib/db" wording didn't anticipate the CLI tooling constraint.
 *
 * KAN-10 schema: guest sessions and the essays associated with them.
 *
 * Declared through `pgSchema`, not the bare `pgTable` export, so every table
 * here is schema-qualified in Postgres (`app.guest_sessions`, `app.essays`,
 * `app.users`) rather than landing in `public` by omission — the local
 * database and the shared production Cloud SQL instance are already kept
 * apart at the connection-string level (see docker-compose.yml / ADR-1,
 * ADR-10); this keeps them apart at the schema level too, so a stray
 * unqualified migration or client can't collide with anything else that
 * later ends up on the same Postgres instance.
 *
 * Essays are text only — no file storage — per this story's scope. Word
 * count enforcement is KAN-14's job (the submission feature), not this
 * layer's; this table only needs to hold and own the text.
 *
 * Every owned table (guest_sessions, essays) carries the same two columns
 * the ownership predicate in `ownership.ts` needs: a `session_id`-shaped
 * column and a nullable `user_id` column. That symmetry is what lets
 * `ownedBy()` work generically across tables instead of special-casing each
 * one, and it's why conversion (see `guest-sessions.ts`) writes `user_id`
 * onto every essay row directly rather than requiring a join back to
 * guest_sessions to determine ownership.
 */
import { sql } from 'drizzle-orm';
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

// Deliberately minimal: this story only needs a stable FK target for
// cascading account erasure (essays.user_id, guest_sessions.user_id). Auth,
// email, and everything else about a registered account belongs to whatever
// story builds registration — not re-scoped in here.
export const users = appSchema.table('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guestSessions = appSchema.table('guest_sessions', {
  // The bearer session id itself (see lib/domain/session-id.ts) — it is its
  // own primary key, not a separate surrogate id.
  id: text('id').primaryKey(),
  // Null until the guest converts to a registered account. Cascades on
  // account erasure: deleting a user deletes any session they converted.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set once, at conversion. Null is the "still a guest" state the
  // ownership predicate keys off; see ownership.ts.
  convertedAt: timestamp('converted_at', { withTimezone: true }),
});

export const essays = appSchema.table('essays', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // Kept for the row's whole lifetime, even after conversion — it records
  // provenance and lets the ownership predicate work without a join.
  // Cascades: deleting the originating guest session deletes its essays.
  sessionId: text('session_id')
    .notNull()
    .references(() => guestSessions.id, { onDelete: 'cascade' }),
  // Null until the owning session converts. Cascades on account erasure.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
