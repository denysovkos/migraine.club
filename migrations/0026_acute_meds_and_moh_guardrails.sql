-- Acute medication effectiveness tracking + MOH guardrails (v1)

ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "medication_class" text DEFAULT 'non_opioid_simple_analgesic' NOT NULL;

ALTER TABLE "user_medications"
ADD COLUMN IF NOT EXISTS "is_acute" boolean DEFAULT true NOT NULL;

ALTER TABLE "user_outcome_settings"
ADD COLUMN IF NOT EXISTS "acute_outcome_reminder_enabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "acute_doses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "medication_id" uuid NOT NULL,
  "attack_id" integer,
  "taken_at" timestamp with time zone NOT NULL,
  "dose" text,
  "unit" text,
  "unit_is_custom" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dose_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "dose_id" uuid NOT NULL,
  "helped" text NOT NULL,
  "back_to_normal_function" boolean,
  "time_to_relief_minutes" integer,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "acute_doses"
  ADD CONSTRAINT "acute_doses_medication_id_user_medications_id_fk"
  FOREIGN KEY ("medication_id") REFERENCES "public"."user_medications"("id")
  ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "acute_doses"
  ADD CONSTRAINT "acute_doses_attack_id_episode_id_fk"
  FOREIGN KEY ("attack_id") REFERENCES "public"."episode"("id")
  ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dose_outcomes"
  ADD CONSTRAINT "dose_outcomes_dose_id_acute_doses_id_fk"
  FOREIGN KEY ("dose_id") REFERENCES "public"."acute_doses"("id")
  ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "acute_doses_user_id_taken_at_idx"
ON "acute_doses" USING btree ("user_id", "taken_at");

CREATE INDEX IF NOT EXISTS "acute_doses_medication_id_taken_at_idx"
ON "acute_doses" USING btree ("medication_id", "taken_at");

CREATE INDEX IF NOT EXISTS "acute_doses_attack_id_idx"
ON "acute_doses" USING btree ("attack_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dose_outcomes_dose_id_uidx"
ON "dose_outcomes" USING btree ("dose_id");

CREATE INDEX IF NOT EXISTS "dose_outcomes_user_id_created_at_idx"
ON "dose_outcomes" USING btree ("user_id", "created_at");
