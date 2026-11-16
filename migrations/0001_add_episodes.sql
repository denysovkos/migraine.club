CREATE TABLE IF NOT EXISTS "episode" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"intensity" integer NOT NULL,
	"pain_location" text NOT NULL,
	"pain_location_other" text,
	"pain_type" text NOT NULL,
	"pain_type_other" text,
	"symptoms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"symptoms_other" text,
	"medications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggers_other" text,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_user_id_start_time_idx" ON "episode" USING btree ("user_id","start_time");

