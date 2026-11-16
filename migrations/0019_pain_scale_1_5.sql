-- Map legacy episode intensity (0–10) into the new 1–5 pain level scale.
--
-- Episodes should not use 0 ("no migraine"). Historically, quick-add created episodes with intensity=0.
-- Preferred mapping would be 0 -> NULL, but the `episode.intensity` column is NOT NULL in the current schema,
-- so we map 0 -> 1 (lowest pain level) to remove invalid zeros while keeping the column non-nullable.
--
-- Mapping:
-- 0 -> 1
-- 1–2 -> 1
-- 3–4 -> 2
-- 5–6 -> 3
-- 7–8 -> 4
-- 9–10 -> 5
UPDATE episode
SET intensity = CASE
  WHEN intensity <= 2 THEN 1
  WHEN intensity <= 4 THEN 2
  WHEN intensity <= 6 THEN 3
  WHEN intensity <= 8 THEN 4
  ELSE 5
END;

-- Enforce the new 1–5 scale at the database level.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'episode_intensity_1_5_chk'
  ) THEN
    ALTER TABLE episode
      ADD CONSTRAINT episode_intensity_1_5_chk CHECK (intensity BETWEEN 1 AND 5);
  END IF;
END $$;


