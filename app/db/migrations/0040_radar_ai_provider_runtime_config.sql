CREATE TABLE "radar_ai_provider_runtime_config" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"updated_by_staff_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_ai_provider_runtime_config_provider_check" CHECK ("radar_ai_provider_runtime_config"."provider_id" IN ('anthropic','openai'))
);
--> statement-breakpoint
ALTER TABLE "radar_ai_provider_runtime_config" ADD CONSTRAINT "radar_ai_provider_runtime_config_updated_by_staff_fk" FOREIGN KEY ("updated_by_staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE set null ON UPDATE no action;