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
 * count enforcement is KAN-15's job (the request contract,
 * `lib/contracts/essay-submission.ts`'s `essaySubmissionRequestSchema`), not
 * this layer's; this table only needs to hold and own the text. (Round-1
 * review: this used to say KAN-14 — KAN-14 only left the seam that rule
 * fills, per that schema's own comment; the bound itself is KAN-15.)
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
import { index, integer, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/**
 * KAN-25 — the rate-limit counter, and the answer to "where does the count
 * live" that story is required to state explicitly: in this same Postgres
 * instance, alongside guest_sessions and essays, not in any per-instance
 * memory. Cloud Run scales `writewise-website` to zero and back up to five
 * instances; an in-memory counter is per-process, resets on every cold
 * start, and undercounts by up to 5x whenever traffic happens to land on
 * more than one warm instance at once — it would pass every local/single-
 * instance test and do nothing in production. Nothing else already deployed
 * for this product (no Redis, no Memorystore) survives scale-to-zero and is
 * shared across instances the way this database already has to be for every
 * other guest-flow table; reaching for new infrastructure to do what this
 * table already does would be exactly the kind of deferred-infra call this
 * story is told to escalate, not build around.
 *
 * A fixed-window counter, not a sliding one: `windowStart` is a bucket's
 * window truncated to a whole multiple of its length (see
 * `lib/domain/rate-limit.ts::windowStartFor`), and `count` is incremented
 * atomically by a single `INSERT ... ON CONFLICT (bucket_key, window_start)
 * DO UPDATE SET count = count + 1` (lib/db/rate-limit.ts) — one statement,
 * so two requests racing the same bucket in the same window can never lose
 * an increment to a read-then-write gap, across instances, because Postgres
 * itself serialises the conflicting row lock, not application code. The
 * known trade-off of a fixed (rather than sliding) window: a caller can
 * submit up to 2x a limit across a window boundary (e.g. 5 requests at
 * :59:59, 5 more at :00:01). Accepted for phase one — "basic protection, not
 * bot detection" — see this story's own PR description for what a sliding
 * window would cost instead.
 *
 * `bucketKey` alone is not unique — the same key recurs every window, which
 * is the whole point (yesterday's count must not suppress today's) — so the
 * primary key is the pair. Rows are never deleted by this story: a bucket
 * this table has ever seen accumulates one row per window forever. Left for
 * a follow-up (see the PR description) — a periodic sweep of rows whose
 * `window_start` is more than a handful of windows old, the same shape as
 * the retention sweep `guest_sessions`' own schema comment already defers.
 */
export const rateLimitCounters = fluentinaSchema.table(
  'rate_limit_counters',
  {
    // Encodes both the action and the identity being counted, e.g.
    // "essaySubmission:session:<id>" or "essaySubmission:ip:<ip>" — see
    // lib/domain/rate-limit.ts for the exact strings. Free-form on purpose:
    // this table has no idea what a "session" or an "IP" is, only that two
    // requests with the same key in the same window count against each
    // other.
    bucketKey: text('bucket_key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucketKey, table.windowStart] })],
);
