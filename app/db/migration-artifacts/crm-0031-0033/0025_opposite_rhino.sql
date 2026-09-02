CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"path" text,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_events_org_occurred_idx" ON "product_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "product_events_user_occurred_idx" ON "product_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "product_events_type_occurred_idx" ON "product_events" USING btree ("event_type","occurred_at");