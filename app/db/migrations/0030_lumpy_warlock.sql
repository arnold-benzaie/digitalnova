ALTER TABLE "crm_invoice_items" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "crm_quote_items" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "crm_invoice_items" ADD CONSTRAINT "crm_invoice_items_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote_items" ADD CONSTRAINT "crm_quote_items_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_invoice_items_service_id_idx" ON "crm_invoice_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "crm_quote_items_service_id_idx" ON "crm_quote_items" USING btree ("service_id");