CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes for fast fuzzy ILIKE search
CREATE INDEX IF NOT EXISTS "medications_catalog_canonical_name_trgm_gin_idx"
ON "medications_catalog"
USING gin ("canonical_name" gin_trgm_ops);

-- Prefer querying medications_catalog.search_text (added in 0016) for canonical+aliases search.

CREATE INDEX IF NOT EXISTS "user_medications_custom_name_trgm_gin_idx"
ON "user_medications"
USING gin ("custom_name" gin_trgm_ops);


