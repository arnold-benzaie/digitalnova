CREATE TABLE "crm_quote_access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_quote_access_links" ADD CONSTRAINT "crm_quote_access_links_quote_id_crm_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."crm_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_quote_access_links_quote_id_idx" ON "crm_quote_access_links" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_quote_access_links_token_idx" ON "crm_quote_access_links" USING btree ("token");