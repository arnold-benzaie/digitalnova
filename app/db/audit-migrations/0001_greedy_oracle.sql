ALTER TABLE "gbp_audit_evidence" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "gbp_audit_evidence" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "gbp_audit_evidence" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "gbp_audit_evidence" ADD COLUMN "content_base64" text;