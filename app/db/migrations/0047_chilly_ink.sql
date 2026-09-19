CREATE TABLE "discovery_budget_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid,
	"budget_id" uuid,
	"movement_type" text NOT NULL,
	"amount" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"provider" text,
	"related_entity" text,
	"country" text,
	"region" text,
	"city" text,
	"zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_budget_ledger_movement_type_check" CHECK ("discovery_budget_ledger"."movement_type" IN ('reserve','settle','release','adjust','expire')),
	CONSTRAINT "discovery_budget_ledger_operation_type_check" CHECK ("discovery_budget_ledger"."operation_type" IN ('search','enrichment'))
);
--> statement-breakpoint
CREATE TABLE "discovery_budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"month_period_key" text NOT NULL,
	"day_period_key" text NOT NULL,
	"amount" integer NOT NULL,
	"actual_amount" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "discovery_budget_reservations_status_check" CHECK ("discovery_budget_reservations"."status" IN ('active','settled','released','expired')),
	CONSTRAINT "discovery_budget_reservations_operation_type_check" CHECK ("discovery_budget_reservations"."operation_type" IN ('search','enrichment')),
	CONSTRAINT "discovery_budget_reservations_amount_check" CHECK ("discovery_budget_reservations"."amount" > 0),
	CONSTRAINT "discovery_budget_reservations_actual_amount_check" CHECK ("discovery_budget_reservations"."actual_amount" IS NULL OR "discovery_budget_reservations"."actual_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discovery_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" text NOT NULL,
	"period_type" text NOT NULL,
	"period_key" text NOT NULL,
	"allocated" integer NOT NULL,
	"remaining" integer NOT NULL,
	"warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_budgets_operation_type_check" CHECK ("discovery_budgets"."operation_type" IN ('search','enrichment')),
	CONSTRAINT "discovery_budgets_period_type_check" CHECK ("discovery_budgets"."period_type" IN ('month','day')),
	CONSTRAINT "discovery_budgets_allocated_check" CHECK ("discovery_budgets"."allocated" >= 0),
	CONSTRAINT "discovery_budgets_remaining_check" CHECK ("discovery_budgets"."remaining" >= 0 AND "discovery_budgets"."remaining" <= "discovery_budgets"."allocated"),
	CONSTRAINT "discovery_budgets_warning_threshold_check" CHECK ("discovery_budgets"."warning_threshold_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "discovery_price_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"sku" text NOT NULL,
	"operation" text NOT NULL,
	"field_set" text NOT NULL,
	"unit" text NOT NULL,
	"price" numeric(12, 6),
	"currency" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source" text,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_price_catalog_operation_check" CHECK ("discovery_price_catalog"."operation" IN ('search','get_details')),
	CONSTRAINT "discovery_price_catalog_price_check" CHECK ("discovery_price_catalog"."price" IS NULL OR "discovery_price_catalog"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discovery_budget_ledger" ADD CONSTRAINT "discovery_budget_ledger_reservation_id_discovery_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."discovery_budget_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_budget_ledger" ADD CONSTRAINT "discovery_budget_ledger_budget_id_discovery_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."discovery_budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_budget_ledger_idempotency_movement_budget_idx" ON "discovery_budget_ledger" USING btree ("idempotency_key","movement_type","budget_id");--> statement-breakpoint
CREATE INDEX "discovery_budget_ledger_reservation_id_idx" ON "discovery_budget_ledger" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "discovery_budget_ledger_budget_id_idx" ON "discovery_budget_ledger" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_budget_reservations_idempotency_key_idx" ON "discovery_budget_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "discovery_budget_reservations_status_idx" ON "discovery_budget_reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_budgets_scope_idx" ON "discovery_budgets" USING btree ("operation_type","period_type","period_key");--> statement-breakpoint
CREATE INDEX "discovery_price_catalog_lookup_idx" ON "discovery_price_catalog" USING btree ("provider","operation","field_set","enabled");