ALTER TABLE "crm_clients" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_clients_assigned_user_id_idx" ON "crm_clients" USING btree ("assigned_user_id");