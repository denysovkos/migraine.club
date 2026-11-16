-- Doctor-grade tracking & outcomes (F16/F32/F33/F34/F35)

-- Ensure we can reference (episode_id, user_id) for strict ownership constraints
CREATE UNIQUE INDEX IF NOT EXISTS "episode_id_user_id_uidx" ON "episode" USING btree ("id","user_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" integer NOT NULL,
	"name" text NOT NULL,
	"class" text,
	"taken_at" timestamptz NOT NULL,
	"timing_relative" text,
	"effectiveness" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "episode_medications_class_chk" CHECK (
    "class" IS NULL OR "class" IN ('NSAID','TRIPTAN','GEPANT','DITAN','COMBINATION','OTHER','UNKNOWN')
  ),
	CONSTRAINT "episode_medications_timing_relative_chk" CHECK (
    "timing_relative" IS NULL OR "timing_relative" IN ('BEFORE_START','DURING','AFTER_END','UNKNOWN')
  ),
	CONSTRAINT "episode_medications_effectiveness_chk" CHECK (
    "effectiveness" IS NULL OR "effectiveness" IN ('NO_RELIEF','PARTIAL','GOOD')
  )
);

--> statement-breakpoint
ALTER TABLE "episode_medications"
  ADD CONSTRAINT "episode_medications_episode_user_fk"
  FOREIGN KEY ("episode_id","user_id") REFERENCES "episode"("id","user_id")
  ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "episode_medications"
  ADD CONSTRAINT "episode_medications_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_user_id_idx" ON "episode_medications" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_episode_id_idx" ON "episode_medications" USING btree ("episode_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_medications_user_id_taken_at_idx" ON "episode_medications" USING btree ("user_id","taken_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"taken_at" timestamptz NOT NULL,
	"period_start" timestamptz,
	"period_end" timestamptz,
	"answers" jsonb NOT NULL,
	"score_total" integer,
	"score_details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "questionnaire_responses_type_chk" CHECK (
    "type" IN ('HIT6','MIDAS','MSQ21')
  )
);

--> statement-breakpoint
ALTER TABLE "questionnaire_responses"
  ADD CONSTRAINT "questionnaire_responses_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questionnaire_responses_user_id_idx" ON "questionnaire_responses" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questionnaire_responses_user_type_taken_at_idx" ON "questionnaire_responses" USING btree ("user_id","type","taken_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_outcome_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"baseline_start" timestamptz,
	"baseline_end" timestamptz,
	"preferred_window_days" integer DEFAULT 28 NOT NULL,
	"timezone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "user_outcome_settings"
  ADD CONSTRAINT "user_outcome_settings_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_outcome_settings_user_id_uidx" ON "user_outcome_settings" USING btree ("user_id");


