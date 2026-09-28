CREATE TABLE "fluentina"."grading_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"essay_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_type" text,
	"prompt_injection_suspected" boolean DEFAULT false NOT NULL,
	"raw_input" text,
	"raw_output" text,
	"result" jsonb,
	CONSTRAINT "grading_jobs_essay_id_unique" UNIQUE("essay_id")
);
--> statement-breakpoint
ALTER TABLE "fluentina"."grading_jobs" ADD CONSTRAINT "grading_jobs_essay_id_essays_id_fk" FOREIGN KEY ("essay_id") REFERENCES "fluentina"."essays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grading_jobs_status_idx" ON "fluentina"."grading_jobs" USING btree ("status");