ALTER TABLE "google_oauth_connections" ADD COLUMN "gbp_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_oauth_connections" ADD COLUMN "gbp_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "google_oauth_connections" ADD COLUMN "analytics_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_oauth_connections" ADD COLUMN "analytics_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "google_oauth_connections" ADD COLUMN "search_console_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_oauth_connections" ADD COLUMN "search_console_last_sync_error" text;