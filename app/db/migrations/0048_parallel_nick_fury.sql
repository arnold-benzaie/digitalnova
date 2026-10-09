ALTER TABLE "interactions" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interactions_deal_id_idx" ON "interactions" USING btree ("deal_id");