CREATE TABLE "crm_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"quote_id" uuid,
	"deal_id" uuid,
	"invoice_number" text NOT NULL,
	"title" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tax_label" text,
	"tax_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"fastspring_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"quote_number" text NOT NULL,
	"title" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tax_label" text,
	"tax_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone,
	"notes" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_invoice_items" ADD CONSTRAINT "crm_invoice_items_invoice_id_crm_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."crm_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_quote_id_crm_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."crm_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoices" ADD CONSTRAINT "crm_invoices_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote_items" ADD CONSTRAINT "crm_quote_items_quote_id_crm_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."crm_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quotes" ADD CONSTRAINT "crm_quotes_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quotes" ADD CONSTRAINT "crm_quotes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_invoice_items_invoice_id_idx" ON "crm_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "crm_invoices_client_id_idx" ON "crm_invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "crm_invoices_quote_id_idx" ON "crm_invoices" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "crm_invoices_deal_id_idx" ON "crm_invoices" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "crm_invoices_fastspring_reference_idx" ON "crm_invoices" USING btree ("fastspring_reference");--> statement-breakpoint
CREATE INDEX "crm_quote_items_quote_id_idx" ON "crm_quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "crm_quotes_client_id_idx" ON "crm_quotes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "crm_quotes_deal_id_idx" ON "crm_quotes" USING btree ("deal_id");