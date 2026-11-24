-- Unified Daily Diary + Attacks (day-centric backbone)
-- - daily_diary_entry: status -> day_type, add created_from, remove deprecated columns
-- - episode: add attack_type ('migraine' | 'headache')

-- 1) Episodes become "Attacks" with classification
ALTER TABLE "episode"
  ADD COLUMN IF NOT EXISTS "attack_type" text NOT NULL DEFAULT 'migraine';

CREATE INDEX IF NOT EXISTS "episode_user_id_attack_type_idx"
  ON "episode" USING btree ("user_id","attack_type");

-- 2) Daily diary entries become day-level backbone
-- Rename status -> day_type (idempotent-ish: only rename when old column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'daily_diary_entry'
      AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'daily_diary_entry'
      AND column_name = 'day_type'
  ) THEN
    ALTER TABLE "daily_diary_entry" RENAME COLUMN "status" TO "day_type";
  END IF;
END $$;

-- Map legacy values:
-- - no_headache -> headache_free
-- - headache -> headache_day
UPDATE "daily_diary_entry"
SET "day_type" = CASE
  WHEN "day_type" = 'no_headache' THEN 'headache_free'
  WHEN "day_type" = 'headache' THEN 'headache_day'
  ELSE "day_type"
END
WHERE "day_type" IN ('no_headache', 'headache');

ALTER TABLE "daily_diary_entry"
  ADD COLUMN IF NOT EXISTS "created_from" text NOT NULL DEFAULT 'user';

-- Drop deprecated per-day columns (medication days are evidence-based from medication_intakes)
ALTER TABLE "daily_diary_entry"
  DROP COLUMN IF EXISTS "peak_intensity",
  DROP COLUMN IF EXISTS "acute_meds_taken";


