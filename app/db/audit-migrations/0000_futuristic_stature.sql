CREATE TABLE "audit_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"google_display_name" text,
	"industry" text,
	"primary_category" text,
	"secondary_categories" jsonb DEFAULT '[]'::jsonb,
	"address" text,
	"service_area" text,
	"city" text,
	"region" text,
	"country" text,
	"phone" text,
	"website_url" text,
	"google_profile_url" text,
	"google_maps_url" text,
	"google_place_id" text,
	"opening_hours" jsonb,
	"location_count" integer DEFAULT 1 NOT NULL,
	"profile_status" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"preferred_language" text DEFAULT 'fr' NOT NULL,
	"country" text,
	"timezone" text,
	"source" text,
	"owner_name" text,
	"notes" text,
	"crm_client_id_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_staff_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "audit_staff_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "audit_staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"target_url" text,
	"payload" jsonb,
	"status" text NOT NULL,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "gbp_audit_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"finding_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_audit_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"storage_bucket" text,
	"storage_path" text,
	"kind" text DEFAULT 'screenshot' NOT NULL,
	"url" text,
	"note" text,
	"annotations" jsonb,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"section_code" text NOT NULL,
	"check_key" text NOT NULL,
	"result" text DEFAULT 'not_verifiable' NOT NULL,
	"severity" text,
	"explanation" text,
	"source" text,
	"recommendation" text,
	"owner_name" text,
	"eta_days" integer,
	"correction_status" text DEFAULT 'detected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_audit_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"client_summary" text,
	"recommended_offer_ids" jsonb DEFAULT '[]'::jsonb,
	"pdf_storage_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_audit_reports_audit_id_unique" UNIQUE("audit_id")
);
--> statement-breakpoint
CREATE TABLE "gbp_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"assigned_agent_name" text,
	"supervisor_name" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"score_overall" integer,
	"score_compliance" integer,
	"score_completeness" integer,
	"score_reputation" integer,
	"score_content" integer,
	"score_local_consistency" integer,
	"score_visibility" integer,
	"score_suspension_risk" integer,
	"score_user_experience" integer,
	"executive_summary" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_name" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"google_profile_url" text,
	"rating" integer,
	"review_count" integer,
	"last_review_at" timestamp with time zone,
	"response_rate_basis_points" integer,
	"categories" jsonb DEFAULT '[]'::jsonb,
	"photo_count" integer,
	"posts_recent" boolean,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_correction_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"finding_id" uuid,
	"phase" integer NOT NULL,
	"title" text NOT NULL,
	"priority" text DEFAULT 'moderate' NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"eta_days" integer,
	"owner_name" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"recommended_service_offer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_finding_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"service_offer_id" uuid,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_report_access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"token" text NOT NULL,
	"one_time_code" text,
	"expires_at" timestamp with time zone,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_link_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "gbp_service_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"cta_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_service_offers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "audit_activity_log" ADD CONSTRAINT "audit_activity_log_actor_user_id_audit_staff_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."audit_staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_businesses" ADD CONSTRAINT "audit_businesses_prospect_id_audit_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."audit_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_notifications" ADD CONSTRAINT "audit_notifications_recipient_user_id_audit_staff_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."audit_staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_staff_memberships" ADD CONSTRAINT "audit_staff_memberships_user_id_audit_staff_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."audit_staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_staff_memberships" ADD CONSTRAINT "audit_staff_memberships_role_id_audit_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."audit_staff_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audit_comments" ADD CONSTRAINT "gbp_audit_comments_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audit_comments" ADD CONSTRAINT "gbp_audit_comments_finding_id_gbp_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."gbp_audit_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audit_evidence" ADD CONSTRAINT "gbp_audit_evidence_finding_id_gbp_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."gbp_audit_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audit_findings" ADD CONSTRAINT "gbp_audit_findings_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audit_reports" ADD CONSTRAINT "gbp_audit_reports_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audits" ADD CONSTRAINT "gbp_audits_business_id_audit_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."audit_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_audits" ADD CONSTRAINT "gbp_audits_prospect_id_audit_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."audit_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_competitors" ADD CONSTRAINT "gbp_competitors_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_correction_tasks" ADD CONSTRAINT "gbp_correction_tasks_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_correction_tasks" ADD CONSTRAINT "gbp_correction_tasks_finding_id_gbp_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."gbp_audit_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_correction_tasks" ADD CONSTRAINT "gbp_correction_tasks_recommended_service_offer_id_gbp_service_offers_id_fk" FOREIGN KEY ("recommended_service_offer_id") REFERENCES "public"."gbp_service_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_finding_status_history" ADD CONSTRAINT "gbp_finding_status_history_finding_id_gbp_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."gbp_audit_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_quote_requests" ADD CONSTRAINT "gbp_quote_requests_audit_id_gbp_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."gbp_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_quote_requests" ADD CONSTRAINT "gbp_quote_requests_service_offer_id_gbp_service_offers_id_fk" FOREIGN KEY ("service_offer_id") REFERENCES "public"."gbp_service_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_report_access_links" ADD CONSTRAINT "gbp_report_access_links_report_id_gbp_audit_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."gbp_audit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_report_views" ADD CONSTRAINT "gbp_report_views_access_link_id_gbp_report_access_links_id_fk" FOREIGN KEY ("access_link_id") REFERENCES "public"."gbp_report_access_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_activity_log_actor_user_id_idx" ON "audit_activity_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_businesses_prospect_id_idx" ON "audit_businesses" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "audit_notifications_recipient_user_id_idx" ON "audit_notifications" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "audit_prospects_crm_client_id_ref_idx" ON "audit_prospects" USING btree ("crm_client_id_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_staff_memberships_user_id_idx" ON "audit_staff_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_staff_users_clerk_user_id_idx" ON "audit_staff_users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "gbp_audit_comments_audit_id_idx" ON "gbp_audit_comments" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "gbp_audit_evidence_finding_id_idx" ON "gbp_audit_evidence" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "gbp_audit_findings_audit_id_idx" ON "gbp_audit_findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "gbp_audit_findings_section_code_idx" ON "gbp_audit_findings" USING btree ("section_code");--> statement-breakpoint
CREATE INDEX "gbp_audits_business_id_idx" ON "gbp_audits" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "gbp_audits_prospect_id_idx" ON "gbp_audits" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "gbp_audits_status_idx" ON "gbp_audits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gbp_competitors_audit_id_idx" ON "gbp_competitors" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "gbp_correction_tasks_audit_id_idx" ON "gbp_correction_tasks" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "gbp_finding_status_history_finding_id_idx" ON "gbp_finding_status_history" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "gbp_quote_requests_audit_id_idx" ON "gbp_quote_requests" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_report_access_links_token_idx" ON "gbp_report_access_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "gbp_report_views_access_link_id_idx" ON "gbp_report_views" USING btree ("access_link_id");