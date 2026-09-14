CREATE SCHEMA "fluentina";
--> statement-breakpoint
CREATE TABLE "fluentina"."essays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluentina"."guest_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fluentina"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluentina"."essays" ADD CONSTRAINT "essays_session_id_guest_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "fluentina"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluentina"."essays" ADD CONSTRAINT "essays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "fluentina"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluentina"."guest_sessions" ADD CONSTRAINT "guest_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "fluentina"."users"("id") ON DELETE cascade ON UPDATE no action;