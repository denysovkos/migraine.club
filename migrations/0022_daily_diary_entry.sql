-- Feature F37: Daily diary entries (explicit headache-free days; missing = no row)

CREATE TABLE IF NOT EXISTS "daily_diary_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"peak_intensity" integer,
	"impact" integer,
	"acute_meds_taken" boolean,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Exactly one entry per user per local calendar date
CREATE UNIQUE INDEX IF NOT EXISTS "daily_diary_entry_user_id_local_date_uidx"
ON "daily_diary_entry" USING btree ("user_id","local_date");

-- Range reads by user + date
CREATE INDEX IF NOT EXISTS "daily_diary_entry_user_id_local_date_idx"
ON "daily_diary_entry" USING btree ("user_id","local_date");


