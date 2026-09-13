CREATE TABLE "radar_ai_quota_policy" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"daily_request_limit" integer,
	"daily_token_limit" integer,
	"warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"updated_by_staff_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_ai_quota_policy_singleton_check" CHECK ("radar_ai_quota_policy"."id" = 'global'),
	CONSTRAINT "radar_ai_quota_policy_daily_request_limit_check" CHECK ("radar_ai_quota_policy"."daily_request_limit" IS NULL OR "radar_ai_quota_policy"."daily_request_limit" >= 0),
	CONSTRAINT "radar_ai_quota_policy_daily_token_limit_check" CHECK ("radar_ai_quota_policy"."daily_token_limit" IS NULL OR "radar_ai_quota_policy"."daily_token_limit" >= 0),
	CONSTRAINT "radar_ai_quota_policy_warning_threshold_check" CHECK ("radar_ai_quota_policy"."warning_threshold_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "radar_ai_quota_policy" ADD CONSTRAINT "radar_ai_quota_policy_updated_by_staff_member_fk" FOREIGN KEY ("updated_by_staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE set null ON UPDATE no action;