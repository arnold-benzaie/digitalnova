CREATE TABLE "crm_invoice_access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_invoices" DROP CONSTRAINT "crm_invoices_client_id_crm_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_invoices" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "tax_number" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "preferred_locale" text;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "client_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "locale" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "email_delivery_status" text;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD COLUMN "last_delivery_error" text;--> statement-breakpoint
ALTER TABLE "crm_invoice_access_links" ADD CONSTRAINT "crm_invoice_access_links_invoice_id_crm_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."crm_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_invoice_access_links_invoice_id_idx" ON "crm_invoice_access_links" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_invoice_access_links_token_idx" ON "crm_invoice_access_links" USING btree ("token");--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE set null ON UPDATE no action;