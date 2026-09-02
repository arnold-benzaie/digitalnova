CREATE TABLE "service_legacy_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" text NOT NULL,
	"legacy_identifier" text NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "service_market_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"payment_frequency" text NOT NULL,
	"billing_type" text,
	"tax_display" text DEFAULT 'UNSPECIFIED' NOT NULL,
	"cta_type" text NOT NULL,
	"checkout_status" text DEFAULT 'MOCK' NOT NULL,
	CONSTRAINT "service_market_offers_market_currency_check" CHECK (("service_market_offers"."market" = 'CANADA' AND "service_market_offers"."currency" = 'CAD') OR ("service_market_offers"."market" = 'EUROPE' AND "service_market_offers"."currency" = 'EUR')),
	CONSTRAINT "service_market_offers_payment_frequency_check" CHECK ("service_market_offers"."payment_frequency" IN ('ONE_TIME','ANNUAL','MONTHLY')),
	CONSTRAINT "service_market_offers_tax_display_check" CHECK ("service_market_offers"."tax_display" IN ('HT','TTC','UNSPECIFIED')),
	CONSTRAINT "service_market_offers_cta_type_check" CHECK ("service_market_offers"."cta_type" IN ('REQUEST_QUOTE','DIRECT_CHECKOUT','CONTACT','NOT_AVAILABLE')),
	CONSTRAINT "service_market_offers_checkout_status_check" CHECK ("service_market_offers"."checkout_status" IN ('LIVE','READY_BUT_DISABLED','PARTIAL','MOCK','UNKNOWN')),
	CONSTRAINT "service_market_offers_price_check" CHECK ("service_market_offers"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_service_id" text NOT NULL,
	"child_service_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"display_order" integer,
	CONSTRAINT "service_relations_relation_type_check" CHECK ("service_relations"."relation_type" IN ('PACK_INCLUDES','DUO_INCLUDES','ADDON_OF')),
	CONSTRAINT "service_relations_no_self_reference_check" CHECK ("service_relations"."parent_service_id" <> "service_relations"."child_service_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"service_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"category" text,
	"display_name_fr" text NOT NULL,
	"display_name_en" text NOT NULL,
	"description_fr" text NOT NULL,
	"description_en" text NOT NULL,
	"price_derivation" text DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_type_check" CHECK ("services"."type" IN ('INDIVIDUAL_SERVICE','PACK','DUO','ADDON')),
	CONSTRAINT "services_status_check" CHECK ("services"."status" IN ('ACTIVE','LEGACY','DRAFT')),
	CONSTRAINT "services_price_derivation_check" CHECK ("services"."price_derivation" IN ('INDEPENDENT','SUM_OF_CHILDREN','NOT_APPLICABLE'))
);
--> statement-breakpoint
ALTER TABLE "service_legacy_identifiers" ADD CONSTRAINT "service_legacy_identifiers_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_market_offers" ADD CONSTRAINT "service_market_offers_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_relations" ADD CONSTRAINT "service_relations_parent_service_id_services_service_id_fk" FOREIGN KEY ("parent_service_id") REFERENCES "public"."services"("service_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_relations" ADD CONSTRAINT "service_relations_child_service_id_services_service_id_fk" FOREIGN KEY ("child_service_id") REFERENCES "public"."services"("service_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_legacy_identifiers_legacy_identifier_idx" ON "service_legacy_identifiers" USING btree ("legacy_identifier");--> statement-breakpoint
CREATE INDEX "service_market_offers_service_id_idx" ON "service_market_offers" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_market_offers_market_idx" ON "service_market_offers" USING btree ("market");--> statement-breakpoint
CREATE UNIQUE INDEX "service_market_offers_service_market_idx" ON "service_market_offers" USING btree ("service_id","market");--> statement-breakpoint
CREATE INDEX "service_relations_parent_service_id_idx" ON "service_relations" USING btree ("parent_service_id");--> statement-breakpoint
CREATE INDEX "service_relations_child_service_id_idx" ON "service_relations" USING btree ("child_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_relations_parent_child_type_idx" ON "service_relations" USING btree ("parent_service_id","child_service_id","relation_type");--> statement-breakpoint
CREATE INDEX "services_status_idx" ON "services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_category_idx" ON "services" USING btree ("category");