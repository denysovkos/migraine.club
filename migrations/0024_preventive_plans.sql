-- Preventive plans & tracking (Feature F40)

CREATE TABLE IF NOT EXISTS "preventive_plan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "catalog_medication_id" uuid,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "dose_text" text,
  "schedule_type" text NOT NULL,
  "schedule_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "start_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "paused_at" timestamp,
  "stopped_at" timestamp,
  "stop_reason" text,
  "stop_reason_note" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "preventive_intake_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "plan_id" uuid NOT NULL,
  "local_date" date NOT NULL,
  "state" text NOT NULL,
  "taken_at" timestamp,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "preventive_weekly_check_in" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "plan_id" uuid NOT NULL,
  "week_start_local_date" date NOT NULL,
  "side_effects" text NOT NULL,
  "still_taking" text NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "preventive_status_change" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "plan_id" uuid NOT NULL,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "changed_at" timestamp DEFAULT now() NOT NULL,
  "reason" text,
  "reason_note" text
);

DO $$ BEGIN
  ALTER TABLE "preventive_plan"
    ADD CONSTRAINT "preventive_plan_catalog_medication_fk"
    FOREIGN KEY ("catalog_medication_id") REFERENCES "medications_catalog"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "preventive_intake_event"
    ADD CONSTRAINT "preventive_intake_plan_fk"
    FOREIGN KEY ("plan_id") REFERENCES "preventive_plan"("id")
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "preventive_weekly_check_in"
    ADD CONSTRAINT "preventive_checkin_plan_fk"
    FOREIGN KEY ("plan_id") REFERENCES "preventive_plan"("id")
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "preventive_status_change"
    ADD CONSTRAINT "preventive_status_change_plan_fk"
    FOREIGN KEY ("plan_id") REFERENCES "preventive_plan"("id")
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "preventive_plan_user_id_idx"
  ON "preventive_plan" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "preventive_plan_user_status_idx"
  ON "preventive_plan" USING btree ("user_id","status");
CREATE INDEX IF NOT EXISTS "preventive_plan_user_medication_idx"
  ON "preventive_plan" USING btree ("user_id","catalog_medication_id");

CREATE UNIQUE INDEX IF NOT EXISTS "preventive_intake_plan_local_date_uidx"
  ON "preventive_intake_event" USING btree ("plan_id","local_date");
CREATE INDEX IF NOT EXISTS "preventive_intake_user_local_date_idx"
  ON "preventive_intake_event" USING btree ("user_id","local_date");
CREATE INDEX IF NOT EXISTS "preventive_intake_plan_local_date_idx"
  ON "preventive_intake_event" USING btree ("plan_id","local_date");

CREATE UNIQUE INDEX IF NOT EXISTS "preventive_checkin_plan_week_uidx"
  ON "preventive_weekly_check_in" USING btree ("plan_id","week_start_local_date");
CREATE INDEX IF NOT EXISTS "preventive_checkin_user_id_idx"
  ON "preventive_weekly_check_in" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "preventive_status_change_plan_id_idx"
  ON "preventive_status_change" USING btree ("plan_id");
CREATE INDEX IF NOT EXISTS "preventive_status_change_user_id_idx"
  ON "preventive_status_change" USING btree ("user_id");
