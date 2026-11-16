ALTER TABLE "community_report" ADD COLUMN IF NOT EXISTS "resolved_by" text;--> statement-breakpoint
ALTER TABLE "community_report" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_status_idx" ON "community_report" USING btree ("status");