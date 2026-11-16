ALTER TABLE "medications_catalog"
  ADD COLUMN IF NOT EXISTS "canonical_name_lc" text NOT NULL DEFAULT '';

ALTER TABLE "medications_catalog"
  ADD COLUMN IF NOT EXISTS "search_text" text NOT NULL DEFAULT '';

UPDATE "medications_catalog"
SET
  "canonical_name_lc" = lower("canonical_name"),
  "search_text" = "canonical_name"
WHERE "canonical_name_lc" = '' OR "search_text" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "medications_catalog_canonical_name_lc_uidx"
ON "medications_catalog" USING btree ("canonical_name_lc");

CREATE INDEX IF NOT EXISTS "medications_catalog_search_text_trgm_gin_idx"
ON "medications_catalog"
USING gin ("search_text" gin_trgm_ops);


