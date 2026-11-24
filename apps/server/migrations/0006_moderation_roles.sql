-- Add user role column with default 'user'
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';

-- Add moderation resolution fields to community_report table
ALTER TABLE "community_report" ADD COLUMN IF NOT EXISTS "resolved_by" text;
ALTER TABLE "community_report" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;

-- Add index on report status for efficient filtering
CREATE INDEX IF NOT EXISTS "community_report_status_idx" ON "community_report" USING btree ("status");

