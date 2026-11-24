ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "last_used_dose" text;

ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "last_used_unit" text;

ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "last_used_unit_is_custom" boolean DEFAULT false NOT NULL;

ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "user_medications_user_id_last_used_at_idx"
ON "user_medications" USING btree ("user_id", "last_used_at");
