CREATE TABLE IF NOT EXISTS "cycle_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "include_in_exports" boolean DEFAULT false NOT NULL,
  "privacy_mode" text DEFAULT 'local_only' NOT NULL,
  "perimenstrual_window_start_days" integer DEFAULT -2 NOT NULL,
  "perimenstrual_window_end_days" integer DEFAULT 3 NOT NULL,
  "hormone_profile" text DEFAULT 'unknown' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_settings_user_id_uidx" ON "cycle_settings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_settings_user_id_idx" ON "cycle_settings" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_bleeding_day" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "local_date" date NOT NULL,
  "bleeding" boolean DEFAULT true NOT NULL,
  "flow" text DEFAULT 'unspecified' NOT NULL,
  "source" text DEFAULT 'user' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_bleeding_day_user_id_local_date_uidx"
  ON "cycle_bleeding_day" USING btree ("user_id", "local_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_bleeding_day_user_id_local_date_idx"
  ON "cycle_bleeding_day" USING btree ("user_id", "local_date");
