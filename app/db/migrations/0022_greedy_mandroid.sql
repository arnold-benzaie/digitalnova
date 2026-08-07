CREATE TABLE "system_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"error_category" text,
	"alert_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_health_checks_service_created_idx" ON "system_health_checks" USING btree ("service","created_at");--> statement-breakpoint
CREATE INDEX "system_health_checks_status_idx" ON "system_health_checks" USING btree ("status");