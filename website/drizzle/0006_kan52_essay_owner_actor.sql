DROP INDEX "fluentina"."essays_session_id_idx";--> statement-breakpoint
ALTER TABLE "fluentina"."essays" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
-- Backfill, hand-written: drizzle-kit generates schema changes, not data. It must run AFTER the DROP NOT NULL above (it writes NULLs) and BEFORE the CHECK below (which the un-nulled rows would violate). A no-op against every database that exists today (conversion had never run against real data); written anyway so the migration is correct if it is ever run against a populated one. Every essay an account owns loses its guest-session anchor, which is also what takes it out of the guest_sessions ON DELETE CASCADE.
UPDATE "fluentina"."essays" SET "session_id" = NULL WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "essays_session_id_idx" ON "fluentina"."essays" USING btree ("session_id") WHERE session_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "fluentina"."essays" ADD CONSTRAINT "essays_exactly_one_owner" CHECK (num_nonnulls(user_id, session_id) = 1);
