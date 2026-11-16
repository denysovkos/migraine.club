-- Risk alert run table for deduplication
CREATE TABLE IF NOT EXISTS "risk_alert_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_alert_run_user_date_type_idx" ON "risk_alert_run" USING btree ("user_id", "local_date", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_alert_run_user_id_idx" ON "risk_alert_run" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_alert_run_created_at_idx" ON "risk_alert_run" USING btree ("created_at");
--> statement-breakpoint
-- Add alerts_enabled column to user_weather_settings
ALTER TABLE "user_weather_settings" ADD COLUMN IF NOT EXISTS "alerts_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Add index for efficient timezone + alerts queries
CREATE INDEX IF NOT EXISTS "user_weather_settings_tz_alerts_idx" ON "user_weather_settings" USING btree ("timezone", "alerts_enabled");
