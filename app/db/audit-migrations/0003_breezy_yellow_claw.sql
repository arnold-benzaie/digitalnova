CREATE TABLE "audit_staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_staff_invitations" ADD CONSTRAINT "audit_staff_invitations_role_id_audit_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."audit_staff_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_staff_invitations" ADD CONSTRAINT "audit_staff_invitations_invited_by_user_id_audit_staff_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."audit_staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_staff_invitations_email_idx" ON "audit_staff_invitations" USING btree ("email");