CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"invited_by_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_invitations_status_check" CHECK ("staff_invitations"."status" IN ('pending','claimed','revoked'))
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_members_status_check" CHECK ("staff_members"."status" IN ('ACTIVE','SUSPENDED','OFFBOARDING'))
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_workspace_org_id_organizations_id_fk" FOREIGN KEY ("workspace_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_workspace_org_id_organizations_id_fk" FOREIGN KEY ("workspace_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_invitations_email_idx" ON "staff_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "staff_invitations_workspace_status_idx" ON "staff_invitations" USING btree ("workspace_org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_user_workspace_unique" ON "staff_members" USING btree ("user_id","workspace_org_id");--> statement-breakpoint
CREATE INDEX "staff_members_workspace_role_status_idx" ON "staff_members" USING btree ("workspace_org_id","role_id","status");--> statement-breakpoint
-- Phase 2B.1-B.0 M-1 (human-approved): deterministic, idempotent seed of the
-- closed staff-role catalogue. Mirrors lib/rbac/permissions.ts STAFF_ROLES.
-- Never a CLIENT row. Replay-safe via ON CONFLICT DO NOTHING.
INSERT INTO "staff_roles" ("name")
VALUES
	('OWNER'),
	('ADMIN'),
	('MANAGER'),
	('EMPLOYEE')
ON CONFLICT ("name") DO NOTHING;