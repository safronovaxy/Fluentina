CREATE TABLE "fluentina"."consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document_version" text NOT NULL,
	"granted" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluentina"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluentina"."users" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fluentina"."users" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fluentina"."users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fluentina"."consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "fluentina"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluentina"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "fluentina"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_user_kind_recorded_idx" ON "fluentina"."consent_records" USING btree ("user_id","kind","recorded_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "fluentina"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "fluentina"."sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "fluentina"."users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");