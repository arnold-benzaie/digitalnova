ALTER TABLE "crm_clients" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN "do_not_contact_reason" text;--> statement-breakpoint
CREATE INDEX "crm_clients_industry_idx" ON "crm_clients" USING btree ("industry");