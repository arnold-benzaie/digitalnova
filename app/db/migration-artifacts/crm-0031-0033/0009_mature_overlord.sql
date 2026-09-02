CREATE TABLE "analytics_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"bounce_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_resource_name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_console_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr_basis_points" integer DEFAULT 0 NOT NULL,
	"average_position_centiles" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_console_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"permission_level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_metrics" ADD CONSTRAINT "analytics_metrics_property_id_analytics_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."analytics_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_properties" ADD CONSTRAINT "analytics_properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_metrics" ADD CONSTRAINT "search_console_metrics_property_id_search_console_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."search_console_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD CONSTRAINT "search_console_properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_metrics_property_date_idx" ON "analytics_metrics" USING btree ("property_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_properties_org_property_idx" ON "analytics_properties" USING btree ("organization_id","property_resource_name");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_metrics_property_date_idx" ON "search_console_metrics" USING btree ("property_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_properties_org_site_idx" ON "search_console_properties" USING btree ("organization_id","site_url");