ALTER TABLE "notifications" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_pending_user_unique" ON "notifications" USING btree (("metadata"->>'userId')) WHERE "notifications"."type" = 'user.pending_approval' AND "notifications"."read" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_is_internal_unique" ON "organizations" USING btree ("is_internal") WHERE "organizations"."is_internal" = true;