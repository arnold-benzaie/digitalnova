CREATE TABLE "discovery_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"address" text,
	"country" text,
	"region" text,
	"city" text,
	"postal_code" text,
	"phone" text,
	"email" text,
	"website" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"timezone" text,
	"opening_hours" jsonb,
	"status" text DEFAULT 'discovered' NOT NULL,
	"crm_client_id" uuid,
	CONSTRAINT "discovery_results_status_check" CHECK ("discovery_results"."status" IN ('discovered','enriched','converted','ignored')),
	CONSTRAINT "discovery_results_latitude_check" CHECK ("discovery_results"."latitude" IS NULL OR ("discovery_results"."latitude" BETWEEN -90 AND 90)),
	CONSTRAINT "discovery_results_longitude_check" CHECK ("discovery_results"."longitude" IS NULL OR ("discovery_results"."longitude" BETWEEN -180 AND 180)),
	CONSTRAINT "discovery_results_converted_link_check" CHECK ("discovery_results"."crm_client_id" IS NULL OR "discovery_results"."status" = 'converted')
);
--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_crm_client_id_crm_clients_id_fk" FOREIGN KEY ("crm_client_id") REFERENCES "public"."crm_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_results_source_source_id_idx" ON "discovery_results" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "discovery_results_status_idx" ON "discovery_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discovery_results_crm_client_id_idx" ON "discovery_results" USING btree ("crm_client_id");