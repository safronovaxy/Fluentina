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
import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const fluentinaSchema = pgSchema('fluentina');

// KAN-10 created this as a bare FK target for cascading account erasure.
// KAN-20 (registration) fills it in: an email, a self-describing password
// hash, and when (not just whether) the email was verified.
export const users = fluentinaSchema.table('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // Stored normalised (trimmed, lower-cased — `emailSchema` in
  // lib/contracts/auth.ts), so this plain unique constraint is the
  // case-insensitive uniqueness rule. Drizzle names it `users_email_unique`;
  // lib/db/users.ts detects a duplicate registration by that constraint name,
  // so renaming it is a behaviour change, not a tidy-up.
  //
  // NOT NULL: every user is a registered user. Adding this to a `users`
  // table that already holds rows fails — none exist outside test fixtures
  // (nothing could create one before this story).
  email: text('email').notNull().unique(),
  // `scrypt$N=32768,r=8,p=1$<salt-b64>$<hash-b64>` — self-describing, so the
  // work factor can be raised, or the algorithm changed, without making
  // existing rows unverifiable. See lib/domain/password.ts. Never selected
  // outside `findUserForLogin` and the rehash-on-login update.
  passwordHash: text('password_hash').notNull(),
  // Null until verified. A timestamp, not a boolean: KAN-51's "resend if
  // older than X" needs the WHEN, and it is the same has-this-happened-and-
  // when shape as `guest_sessions.converted_at`.
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
 * KAN-16 — one row per essay's grading attempt, and the ADR-5 persistence of
 * that job's raw input/output alongside its structured result: "so a future
 * fine-tuning dataset doesn't have to be reconstructed retroactively". This
 * is the Phase 2 calibration dataset KAN-24's own story explicitly is NOT —
 * that story's telemetry is metadata-only, logged centrally (see
 * `lib/domain/grading/telemetry.ts`); THIS table is where the essay text
 * (already stored on `essays.content`), the exact prompt sent, and the
 * exact provider response body live, joinable back to that telemetry by
 * `essay_id` (`submissionId` in the telemetry log) — the join key both
 * stories were told to share rather than inventing two.
 *
 * One row per essay by construction (`essay_id` is both the FK and this
 * table's own primary key) — Phase 1 has no retry-with-a-new-row concept;
 * a Cloud Tasks redelivery of an already-`succeeded`/`failed` job is a
 * no-op against the SAME row (see `orchestrate-grading.ts`'s own
 * idempotency check), never a second attempt recorded alongside the first.
 *
 * Ownership: deliberately NO `session_id`/`user_id` columns of its own,
 * unlike `essays`/`guest_sessions`. A grading job is inherently owned by
 * whoever owns the essay it grades — `lib/db/grading-jobs.ts`'s
 * `getGradingJobByEssayId` joins to `essays` and applies `ownedBy()`
 * against THAT row's columns, rather than this table duplicating them. That
 * also means the post-conversion cutover (the old guest session id must
 * stop authorising reads — KAN-10's own non-negotiable) needs no extra
 * write here at all: the join inherits whatever `essays.user_id` already
 * says, the moment conversion sets it.
 *
 * `raw_input`/`raw_output` are `text`, not `jsonb` — `raw_input` is the
 * prompt sent (a plain string, never JSON itself) and `raw_output` is the
 * provider's raw response BODY, kept exactly as received (so a malformed,
 * non-JSON response is still captured verbatim rather than lost to a parse
 * failure) — `result`, the STRUCTURED `GradingResult`, is the `jsonb` column
 * queried/rendered elsewhere.
 *
 * Cascades on `essay_id`: deleting an essay (which itself cascades from
 * deleting its guest session — see `essays`' own comment) deletes its
 * grading job too, so the 30-day retention sweep and any right-to-erasure
 * cascade reach this table for free, without a second, separately-tracked
 * deletion path — the exact "not an untracked second copy of personal data"
 * requirement KAN-24's own acceptance criteria name for the OTHER (metadata)
 * record applies here too, for this one.
 */
export const gradingJobs = fluentinaSchema.table(
  'grading_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    essayId: uuid('essay_id')
      .notNull()
      .unique()
      .references(() => essays.id, { onDelete: 'cascade' }),
    // 'pending' | 'processing' | 'succeeded' | 'failed' — see
    // lib/contracts/grading-job.ts's GradingJobStatus. Kept as plain text,
    // like every other status-shaped column in this schema (e.g.
    // rate_limit_counters' free-form bucket_key) — the app layer, not a
    // Postgres CHECK/enum, is the single source of truth for the valid set.
    status: text('status').notNull().default('pending'),
    // Null until the job actually starts calling one (see
    // orchestrate-grading.ts) — 'mistral' | 'fake' today, 'claude' once
    // ADR-4's fallback is built (provider-factory.ts).
    provider: text('provider'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // See lib/contracts/grading.ts's GradingFailureReason — a stable code,
    // never a raw error message (which could embed provider response
    // fragments this column has no business holding twice over raw_output).
    errorType: text('error_type'),
    // BR-3.5 — true whenever `detectPromptInjection` (injection-guard.ts)
    // suspected the essay text and this job's result was therefore capped
    // rather than trusted as-is (result.ts's own clampForSuspectedInjection).
    promptInjectionSuspected: boolean('prompt_injection_suspected').notNull().default(false),
    rawInput: text('raw_input'),
    rawOutput: text('raw_output'),
    result: jsonb('result'),
  },
  (table) => [
    // essay_id already carries a UNIQUE constraint above, which Postgres
    // backs with an index automatically — no separate index needed the way
    // essays.session_id/user_id (plain FKs, not unique) require one.
    index('grading_jobs_status_idx').on(table.status),
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
 * primary key is the pair.
 *
 * Round-1 review (Architect, blocking): rows used to be "never deleted by
 * this story", deferred the same way as `guest_sessions`' own 30-day sweep.
 * Two problems with that, both closed by the same fix: `bucketKey` embeds a
 * session id or a client address (see the column's own comment) — personal
 * data — and BOTH counters (session-scoped and address-scoped, see
 * `lib/domain/rate-limit.ts`'s own comment on why both always increment,
 * win or lose) write a row on every single request regardless of whether
 * that request is ultimately refused; a caller rotating cookies (or one
 * behind a rotating address) writes a fresh row every time, so the address
 * cap bounds DECISIONS, not ROWS. The Architect's own estimate under
 * sustained abuse: on the order of 100k rows/day, permanently, with nothing
 * cascading on erasure and nothing caught by any sweep — on the same
 * Postgres instance the production content system shares, so unbounded
 * growth here risks taking that down too on disk exhaustion.
 *
 * `deleteStaleRateLimitCounters` (`lib/db/rate-limit.ts`) deletes rows whose
 * `window_start` is more than two hours behind the window currently being
 * written — a counter has no purpose beyond its own window, and a fixed
 * hourly window never needs to compare against anything older than the
 * immediately preceding one. It runs on every call to
 * `incrementRateLimitCounter`, in the same round trip as the increment
 * itself, NOT on a periodic schedule: no scheduled cleanup path exists
 * anywhere in this codebase today (checked directly — `guest_sessions`' own
 * deferred 30-day sweep has never been built either, despite the comment
 * that used to sit here implying otherwise), and standing up the
 * infrastructure for one (a Cloud Scheduler job, an authenticated endpoint
 * to receive it) is a deployment decision outside this story's scope to
 * make unilaterally. Folding the delete into the write path this table
 * already takes on every check bounds growth today without inventing new
 * infrastructure; `rate_limit_counters_window_start_idx` below is what keeps
 * that delete an indexed range scan rather than a sequential one as the
 * table grows.
 *
 * Round-2 review (Architect): the real guarantee this gives is weaker than
 * "bounded to two hours" on its own, and the line further down that used to
 * say exactly that overstated it. The sweep above runs ONLY on the write
 * path — a service that scales to zero (Cloud Run, see this table's own
 * comment above) has no sweep running while nothing is calling it. A burst
 * of rows written at 2am, with no further traffic until 9am the next day,
 * sits for the full 31 hours in between — not two. The real guarantee is
 * "swept within two hours of the NEXT request that happens to land",
 * whenever that is. Closing that gap for real needs the scheduled sweep
 * path this comment already says doesn't exist anywhere in this codebase —
 * the same one `guest_sessions`' own deferred 30-day retention is waiting
 * on too, not a second, unrelated piece of infrastructure.
 */
export const rateLimitCounters = fluentinaSchema.table(
  'rate_limit_counters',
  {
    // Encodes both the action and the identity being counted, e.g.
    // "essaySubmission:session:<id>" or "essaySubmission:ip:<ip>" — see
    // lib/domain/rate-limit.ts for the exact strings. Free-form on purpose:
    // this table has no idea what a "session" or an "IP" is, only that two
    // requests with the same key in the same window count against each
    // other. Personal data (a session id, a client address) for as long as
    // its row lives — see this table's own comment above for why that's now
    // bounded to roughly two hours after the next write to this table
    // (not forever, and not a hard "two hours from now" either — see that
    // comment's own round-2 correction for the gap between the two).
    bucketKey: text('bucket_key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.bucketKey, table.windowStart] }),
    // The primary key above is (bucketKey, windowStart) — leads with
    // bucketKey, so it cannot serve "every row older than this instant
    // regardless of bucket", the exact query `deleteStaleRateLimitCounters`
    // runs on every increment. Without this, that delete is a sequential
    // scan of the whole table — the same unbounded-growth problem this
    // index exists to close, just moved from row count to query cost.
    index('rate_limit_counters_window_start_idx').on(table.windowStart),
  ],
);

/**
 * KAN-20 — a registered user's login session (database sessions, not JWTs:
 * a row can be deleted, which is what makes logout real).
 *
 * `id` is SHA-256 of the session token, 64 hex characters — NEVER the token
 * itself. Unlike `guest_sessions.id`, nothing has a foreign key to this
 * column, so there is no reason to keep the raw value. Without the hash, any
 * read of this table that does not execute code — a backup, an export, a
 * SQL-injection read — yields every live session token. With it, that same
 * read yields digests that authenticate nothing.
 *
 * Expiry is two independent conditions, both evaluated in SQL in the same
 * WHERE as the lookup (lib/db/sessions.ts), never filtered in JS after the
 * read: an absolute `expires_at` (30 days, matching ADR-17) and an idle
 * timeout on `last_used_at` (14 days).
 *
 * Expired rows are swept on session CREATION (`DELETE ... WHERE expires_at <
 * now()`), not on read: creation is rare, reads are hot, and correctness
 * never depends on the sweep because the lookup filters anyway. The same
 * honest caveat as `rate_limit_counters` above applies verbatim: on a
 * scale-to-zero service this bounds growth, it does not bound it to a fixed
 * interval — expired rows sit until the next sign-in or registration lands
 * on an instance. A Cloud Scheduler job would close that gap; it is not built
 * here, because standing one up is not this story's call to make.
 */
export const sessions = fluentinaSchema.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // The FK side is not indexed for you (same reasoning as
    // guest_sessions.user_id): every account-erasure cascade and every
    // per-user session operation filters on it.
    index('sessions_user_id_idx').on(table.userId),
    // Keeps the sweep an indexed range scan rather than a sequential one.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * KAN-20 / KAN-21 / KAN-22 — who agreed to what, in which version, and when.
 * A versioned, timestamped ROW per decision, never a boolean column on
 * `users`.
 *
 * APPEND-ONLY. A withdrawal is a new row with `granted = false`; nothing in
 * this codebase UPDATEs a row here, and the current state of a `kind` is its
 * most recent row (`lib/db/consent-records.ts`). That is what makes this an
 * audit trail rather than a settings table: "what had this person agreed to
 * on the 3rd of March" stays answerable after they change their mind.
 *
 * Registration writes one row per kind (lib/contracts/consent.ts), INCLUDING
 * marketing when it is unticked, with `granted = false`: affirmative evidence
 * the choice was presented and declined, which a missing row is not.
 *
 * `kind` and `document_version` are plain text, like every other
 * status-shaped column in this schema: the app layer (lib/contracts/
 * consent.ts) is the single source of truth for the valid set, not a
 * Postgres enum a migration must chase. `document_version` is what the form
 * actually rendered, threaded through the request, not a constant stamped on
 * at insert time.
 *
 * Cascades on `user_id`: erasing an account erases its consent trail with it
 * — the one deletion path this table has.
 */
export const consentRecords = fluentinaSchema.table(
  'consent_records',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    documentVersion: text('document_version').notNull(),
    granted: boolean('granted').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves "the latest row per kind for this user" — the only read shape —
    // and doubles as the FK-side index for the erasure cascade.
    index('consent_records_user_kind_recorded_idx').on(table.userId, table.kind, table.recordedAt),
  ],
);
