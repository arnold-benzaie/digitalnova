CREATE TABLE "crm_websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_audit_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text NOT NULL,
	"recommendation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"score" integer,
	"summary" text,
	"page_title" text,
	"meta_description" text,
	"h1_count" integer,
	"indexable" boolean,
	"sitemap_found" boolean,
	"robots_txt_found" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_keyword_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"search_engine" text DEFAULT 'google' NOT NULL,
	"position" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"target_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_websites" ADD CONSTRAINT "crm_websites_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audit_issues" ADD CONSTRAINT "seo_audit_issues_audit_id_seo_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."seo_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_website_id_crm_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."crm_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_keyword_rankings" ADD CONSTRAINT "seo_keyword_rankings_keyword_id_seo_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."seo_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_website_id_crm_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."crm_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_websites_client_id_idx" ON "crm_websites" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "seo_audit_issues_audit_id_idx" ON "seo_audit_issues" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "seo_audits_website_id_idx" ON "seo_audits" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "seo_audits_website_created_idx" ON "seo_audits" USING btree ("website_id","created_at");--> statement-breakpoint
CREATE INDEX "seo_keyword_rankings_keyword_id_idx" ON "seo_keyword_rankings" USING btree ("keyword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_keywords_website_keyword_idx" ON "seo_keywords" USING btree ("website_id","keyword");