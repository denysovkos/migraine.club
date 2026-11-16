ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "theme_preference" text DEFAULT 'light' NOT NULL;
