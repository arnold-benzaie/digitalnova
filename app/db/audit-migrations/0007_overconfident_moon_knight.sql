CREATE TABLE "gbp_audit_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_contact_email" text DEFAULT 'contact@public-map.com' NOT NULL,
	"report_footer_note" text,
	"severity_penalty_critical" integer DEFAULT 14 NOT NULL,
	"severity_penalty_important" integer DEFAULT 7 NOT NULL,
	"severity_penalty_moderate" integer DEFAULT 3 NOT NULL,
	"severity_penalty_opportunity" integer DEFAULT 1 NOT NULL,
	"report_link_default_expiry_days" integer DEFAULT 30 NOT NULL,
	"report_link_max_attempts" integer DEFAULT 10 NOT NULL,
	"notify_on_quote_request" boolean DEFAULT true NOT NULL,
	"notify_on_audit_submitted" boolean DEFAULT true NOT NULL,
	"notify_on_changes_requested" boolean DEFAULT true NOT NULL,
	"notify_on_audit_approved" boolean DEFAULT true NOT NULL,
	"webhooks_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_quote_requests_per_hour" integer DEFAULT 5 NOT NULL,
	"rate_limit_portal_views_per_window" integer DEFAULT 20 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "gbp_audit_settings" ADD CONSTRAINT "gbp_audit_settings_updated_by_user_id_audit_staff_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."audit_staff_users"("id") ON DELETE set null ON UPDATE no action;