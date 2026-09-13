CREATE TABLE "radar_ai_quota_counter" (
	"key" text PRIMARY KEY NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_ai_quota_counter_request_count_check" CHECK ("radar_ai_quota_counter"."request_count" >= 0),
	CONSTRAINT "radar_ai_quota_counter_token_count_check" CHECK ("radar_ai_quota_counter"."token_count" >= 0)
);
