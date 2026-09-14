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
 * here is schema-qualified in Postgres (`fluentina.guest_sessions`, `fluentina.essays`,
 * `fluentina.users`) rather than landing in `public` by omission — the local
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
import { index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const fluentinaSchema = pgSchema('fluentina');

// Deliberately minimal: this story only needs a stable FK target for
// cascading account erasure (essays.user_id, guest_sessions.user_id). Auth,
// email, and everything else about a registered account belongs to whatever
// story builds registration — not re-scoped in here.
export const users = fluentinaSchema.table('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guestSessions = fluentinaSchema.table(
  'guest_sessions',
  {
    // The bearer session id itself (see lib/domain/session-id.ts) — it is
    // its own primary key, not a separate surrogate id.
    id: text('id').primaryKey(),
    // Null until the guest converts to a registered account. Cascades on
    // account erasure: deleting a user deletes any session they converted.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set once, at conversion. Null is the "still a guest" state the
    // ownership predicate keys off; see ownership.ts.
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (table) => [
    // Postgres does not index the referencing side of a foreign key for
    // you. Every account-erasure delete and every retention sweep filters
    // or joins on this column, and without an index each one is a
    // sequential scan of the whole table.
    index('guest_sessions_user_id_idx').on(table.userId),
  ],
);

export const essays = fluentinaSchema.table(
  'essays',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Kept for the row's whole lifetime, even after conversion — it records
    // provenance and lets the ownership predicate work without a join.
    // Cascades: deleting the originating guest session deletes its essays.
    //
    // That cascade is on the session row, not on whether it converted — the
    // FK can express "delete essays when their session is deleted", not
    // "...unless that session has since been attached to an account". A
    // retention sweep that deletes guest_sessions rows older than N days
    // (KAN-10's own scope stops short of writing that sweep) must exclude
    // converted sessions explicitly (`converted_at IS NULL`) or it will
    // cascade-delete a registered user's essays through the session row
    // they originated from, days or months after that user signed up.
    sessionId: text('session_id')
      .notNull()
      .references(() => guestSessions.id, { onDelete: 'cascade' }),
    // Null until the owning session converts. Cascades on account erasure.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Same reasoning as guest_sessions.user_id above: both FK columns are
    // read on every ownership-scoped query and every cascade, and neither
    // gets an index automatically.
    index('essays_session_id_idx').on(table.sessionId),
    index('essays_user_id_idx').on(table.userId),
  ],
);
