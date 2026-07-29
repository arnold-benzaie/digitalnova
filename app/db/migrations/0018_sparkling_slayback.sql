ALTER TABLE "integration_api_keys" ADD COLUMN "last_used_ip" text;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD COLUMN "request_headers" jsonb;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD COLUMN "response_headers" jsonb;