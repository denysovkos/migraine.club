-- Feature F39: Conservative insights cache + factor taxonomy/events
-- Feature: 48h stale (not closed) episode reminder tracking fields

-- 1) Episode reminder tracking fields
ALTER TABLE "episode"
ADD COLUMN IF NOT EXISTS "stale_reminder_sent_at" timestamp with time zone;

ALTER TABLE "episode"
ADD COLUMN IF NOT EXISTS "stale_reminder_count" integer DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS "episode_stale_reminder_sent_at_idx"
ON "episode" USING btree ("stale_reminder_sent_at");

-- 2) Factor taxonomy (minimal; supports trigger/protector/symptom/early-sign classification)
CREATE TABLE IF NOT EXISTS "factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"key" text,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "factor_user_id_idx" ON "factor" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "factor_type_idx" ON "factor" USING btree ("type");

-- Unique key per user when key is provided (built-ins can use user_id NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "factor_user_key_uidx"
ON "factor" USING btree ("user_id", "key")
WHERE "key" IS NOT NULL;

-- 3) Factor event log (timestamped user diary factor logs)
CREATE TABLE IF NOT EXISTS "factor_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"factor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"intensity" integer,
	"source" text DEFAULT 'diary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ALTER TABLE "factor_event"
-- ADD CONSTRAINT IF NOT EXISTS "factor_event_factor_id_factor_id_fk"
-- FOREIGN KEY ("factor_id") REFERENCES "public"."factor"("id")
-- ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "factor_event_user_id_occurred_at_idx"
ON "factor_event" USING btree ("user_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "factor_event_factor_id_occurred_at_idx"
ON "factor_event" USING btree ("factor_id", "occurred_at");

-- 4) Insights cache (per user/window/method version)
CREATE TABLE IF NOT EXISTS "insights_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"window_days" integer NOT NULL,
	"method_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_json" jsonb NOT NULL,
	"input_stats_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "insights_cache_user_window_method_uidx"
ON "insights_cache" USING btree ("user_id", "window_days", "method_version");

CREATE INDEX IF NOT EXISTS "insights_cache_user_id_idx"
ON "insights_cache" USING btree ("user_id");


