ALTER TABLE "medication_intakes" ALTER COLUMN "user_medication_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "medication_intakes" ADD COLUMN IF NOT EXISTS "medication_name" text;--> statement-breakpoint
ALTER TABLE "medications_catalog" ADD COLUMN IF NOT EXISTS "canonical_name_lc" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "medications_catalog" ADD COLUMN IF NOT EXISTS "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "medications_catalog_canonical_name_lc_uidx" ON "medications_catalog" USING btree ("canonical_name_lc");

-- Feature F16.1: Backfill medication_intakes from legacy episode.medications (jsonb).
-- Idempotent: only for episodes that have legacy meds and currently have no intakes.
-- Parse formats: JSON array (objects/strings) OR a scalar string; split on comma/newline/semicolon.
-- Extract a simple dose+unit token like “400 mg”, “0.5 ml”, “2 sprays”, leaving the remainder as medication_name.

WITH episodes_to_migrate AS (
  SELECT
    e.id AS episode_id,
    e.user_id,
    COALESCE(e.start_time, e.created_at) AS taken_at_base,
    e.medications AS legacy_medications
  FROM "episode" e
  WHERE
    e.medications IS NOT NULL
    AND (
      (jsonb_typeof(e.medications) = 'array' AND jsonb_array_length(e.medications) > 0)
      OR (jsonb_typeof(e.medications) = 'string' AND length(btrim(e.medications::text, '\"')) > 0)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "medication_intakes" mi
      WHERE mi.episode_id = e.id
    )
),
raw_items AS (
  SELECT
    e.episode_id,
    e.user_id,
    e.taken_at_base,
    t.item
  FROM episodes_to_migrate e
  CROSS JOIN LATERAL (
    SELECT jsonb_array_elements(e.legacy_medications) AS item
    WHERE jsonb_typeof(e.legacy_medications) = 'array'
    UNION ALL
    SELECT e.legacy_medications AS item
    WHERE jsonb_typeof(e.legacy_medications) <> 'array'
  ) t
),
item_text AS (
  SELECT
    episode_id,
    user_id,
    taken_at_base,
    CASE
      WHEN jsonb_typeof(item) = 'object' THEN
        btrim(
          concat_ws(
            ' ',
            NULLIF(item->>'name', ''),
            NULLIF(item->>'dose', '')
          )
        )
      WHEN jsonb_typeof(item) = 'string' THEN btrim(item::text, '\"')
      ELSE btrim(item::text, '\"')
    END AS raw
  FROM raw_items
),
split_items AS (
  SELECT
    episode_id,
    user_id,
    taken_at_base,
    btrim(x) AS token
  FROM item_text
  CROSS JOIN LATERAL regexp_split_to_table(raw, E'[\\n,;]+') AS x
  WHERE btrim(x) <> ''
),
parsed AS (
  SELECT
    episode_id,
    user_id,
    taken_at_base,
    (regexp_match(token, E'(?i)(\\d+(?:\\.\\d+)?|\\d+\\/\\d+)\\s*([^\\d\\s]+(?:\\([^\\)]*\\))?)'))[1] AS dose_raw,
    (regexp_match(token, E'(?i)(\\d+(?:\\.\\d+)?|\\d+\\/\\d+)\\s*([^\\d\\s]+(?:\\([^\\)]*\\))?)'))[2] AS unit_raw,
    btrim(regexp_replace(
      token,
      E'(?i)(\\d+(?:\\.\\d+)?|\\d+\\/\\d+)\\s*([^\\d\\s]+(?:\\([^\\)]*\\))?)',
      '',
      'g'
    )) AS name_raw
  FROM split_items
),
normalized AS (
  SELECT
    episode_id,
    user_id,
    taken_at_base,
    NULLIF(name_raw, '') AS medication_name,
    NULLIF(dose_raw, '') AS dose,
    NULLIF(unit_raw, '') AS unit,
    CASE
      WHEN unit_raw IS NULL OR unit_raw = '' THEN false
      WHEN lower(unit_raw) IN (
        'mg','g','mcg','ml','iu',
        'tablet(s)','capsule(s)','spray(s)','puff(s)','drop(s)',
        'patch(es)','injection(s)','suppository(ies)','sachet(s)'
      )
        THEN false
      ELSE true
    END AS unit_is_custom
  FROM parsed
  WHERE NULLIF(name_raw, '') IS NOT NULL
)
INSERT INTO "medication_intakes" (
  user_id,
  user_medication_id,
  medication_name,
  episode_id,
  taken_at,
  dose,
  unit,
  unit_is_custom,
  created_at
)
SELECT
  n.user_id,
  NULL,
  n.medication_name,
  n.episode_id,
  n.taken_at_base,
  n.dose,
  n.unit,
  n.unit_is_custom,
  now()
FROM normalized n;