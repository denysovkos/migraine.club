-- Hotfix: some databases may have an older weather_pain_index_snapshot without solar_snapshot_id.
-- Ensure the column exists so code selecting it does not fail (Postgres 42703).

ALTER TABLE "weather_pain_index_snapshot"
ADD COLUMN IF NOT EXISTS "solar_snapshot_id" uuid;


