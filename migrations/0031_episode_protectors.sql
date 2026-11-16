ALTER TABLE "episode"
ADD COLUMN IF NOT EXISTS "protectors" jsonb NOT NULL DEFAULT '[]'::jsonb;
