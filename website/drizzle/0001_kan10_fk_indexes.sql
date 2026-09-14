CREATE INDEX "essays_session_id_idx" ON "fluentina"."essays" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "essays_user_id_idx" ON "fluentina"."essays" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_user_id_idx" ON "fluentina"."guest_sessions" USING btree ("user_id");