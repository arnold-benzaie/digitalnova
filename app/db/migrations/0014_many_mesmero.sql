CREATE TABLE "integration_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"integration_id" uuid,
	"endpoint_id" uuid,
	"triggered_by_user_id" uuid,
	"mode" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"request_payload" jsonb NOT NULL,
	"request_signature" text,
	"response_status" integer,
	"response_body" text,
	"response_duration_ms" integer,
	"error_code" text,
	"replay_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "daily_event_quota" integer;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "quota_enforced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_test_runs" ADD CONSTRAINT "integration_test_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_test_runs" ADD CONSTRAINT "integration_test_runs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_test_runs" ADD CONSTRAINT "integration_test_runs_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_test_runs" ADD CONSTRAINT "integration_test_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_test_runs_organization_idx" ON "integration_test_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_test_runs_endpoint_idx" ON "integration_test_runs" USING btree ("endpoint_id","created_at");