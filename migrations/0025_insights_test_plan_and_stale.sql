-- Feature F39: Insights cache stale flag + test mode plans

ALTER TABLE "insights_cache"
ADD COLUMN IF NOT EXISTS "stale" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "insight_test_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"factor_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"start_date" date NOT NULL,
	"duration_days" integer DEFAULT 14 NOT NULL,
	"notes" text,
	"reminder_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ALTER TABLE "insight_test_plan"
-- ADD CONSTRAINT IF NOT EXISTS "insight_test_plan_factor_id_factor_id_fk"
-- FOREIGN KEY ("factor_id") REFERENCES "public"."factor"("id")
-- ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "insight_test_plan_user_id_idx"
ON "insight_test_plan" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "insight_test_plan_user_status_idx"
ON "insight_test_plan" USING btree ("user_id", "status");

CREATE INDEX IF NOT EXISTS "insight_test_plan_factor_id_idx"
ON "insight_test_plan" USING btree ("factor_id");
