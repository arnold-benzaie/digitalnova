CREATE TABLE "radar_ai_provider_policy" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"mode" text DEFAULT 'AUTO' NOT NULL,
	"default_provider" text,
	"fallback_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selectable_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_user_selection" boolean DEFAULT false NOT NULL,
	"fallback_enabled" boolean DEFAULT true NOT NULL,
	"updated_by_staff_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_ai_provider_policy_singleton_check" CHECK ("radar_ai_provider_policy"."id" = 'global'),
	CONSTRAINT "radar_ai_provider_policy_mode_check" CHECK ("radar_ai_provider_policy"."mode" IN ('AUTO','MANUAL'))
);
--> statement-breakpoint
ALTER TABLE "radar_ai_provider_policy" ADD CONSTRAINT "radar_ai_provider_policy_updated_by_staff_member_fk" FOREIGN KEY ("updated_by_staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE set null ON UPDATE no action;