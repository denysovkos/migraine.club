CREATE TABLE IF NOT EXISTS "episode_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" integer NOT NULL,
	"name" text NOT NULL,
	"class" text,
	"taken_at" timestamp with time zone NOT NULL,
	"timing_relative" text,
	"effectiveness" text,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medication_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_medication_id" uuid NOT NULL,
	"episode_id" integer,
	"taken_at" timestamp with time zone NOT NULL,
	"dose" text,
	"unit" text,
	"unit_is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medications_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"answers" jsonb NOT NULL,
	"score_total" integer,
	"score_details" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"catalog_medication_id" uuid,
	"custom_name" text,
	"default_dose" text,
	"default_unit" text,
	"default_unit_is_custom" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_outcome_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"baseline_start" timestamp with time zone,
	"baseline_end" timestamp with time zone,
	"preferred_window_days" integer DEFAULT 28 NOT NULL,
	"timezone" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_medications" ADD CONSTRAINT "episode_medications_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_intakes" ADD CONSTRAINT "medication_intakes_user_medication_id_user_medications_id_fk" FOREIGN KEY ("user_medication_id") REFERENCES "public"."user_medications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_intakes" ADD CONSTRAINT "medication_intakes_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_user_id_idx" ON "episode_medications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_episode_id_idx" ON "episode_medications" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_user_id_taken_at_idx" ON "episode_medications" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_intakes_user_id_taken_at_idx" ON "medication_intakes" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_intakes_user_medication_id_taken_at_idx" ON "medication_intakes" USING btree ("user_medication_id","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_intakes_episode_id_idx" ON "medication_intakes" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medications_catalog_canonical_name_idx" ON "medications_catalog" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questionnaire_responses_user_id_idx" ON "questionnaire_responses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questionnaire_responses_user_type_taken_at_idx" ON "questionnaire_responses" USING btree ("user_id","type","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_medications_user_id_idx" ON "user_medications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_medications_user_id_is_pinned_idx" ON "user_medications" USING btree ("user_id","is_pinned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_medications_catalog_medication_id_idx" ON "user_medications" USING btree ("catalog_medication_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_outcome_settings_user_id_uidx" ON "user_outcome_settings" USING btree ("user_id");