CREATE TABLE IF NOT EXISTS "community_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"episode_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"is_from_episode" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doctor_share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"recipient_name" text,
	"patient_display_name" text,
	"expires_at" timestamp NOT NULL,
	"date_range_start" timestamp,
	"date_range_end" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_share_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
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
	"weather_pain_index_id" uuid,
	"weather_context" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expiration_time" bigint,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solar_activity_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp_utc" timestamp with time zone NOT NULL,
	"kp_index" double precision NOT NULL,
	"source" text DEFAULT 'noaa' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"consent_type" text NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"given_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_subscription_price_id" text,
	"stripe_subscription_status" text,
	"stripe_subscription_current_period_end" bigint,
	"display_name" text DEFAULT '' NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"community_handle" text,
	"is_doctor" boolean DEFAULT false NOT NULL,
	"is_doctor_verified" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_weather_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"location_label" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_weather_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weather_daily_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"date" date NOT NULL,
	"source" text DEFAULT 'openweathermap' NOT NULL,
	"delta_pressure" double precision NOT NULL,
	"temperature_deviation" double precision NOT NULL,
	"avg_humidity" double precision NOT NULL,
	"avg_wind_speed" double precision NOT NULL,
	"uvi" double precision NOT NULL,
	"raw" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weather_pain_index_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"timestamp_local" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"weather_snapshot_id" uuid,
	"solar_snapshot_id" uuid,
	"wpi_score" double precision NOT NULL,
	"wpi_level" text NOT NULL,
	"components" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_comment_post_id_idx" ON "community_comment" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_comment_parent_id_idx" ON "community_comment" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_author_id_idx" ON "community_post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_created_at_idx" ON "community_post" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_post_score_created_at_idx" ON "community_post" USING btree ("score","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_post_id_idx" ON "community_report" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_comment_id_idx" ON "community_report" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_reporter_id_idx" ON "community_report" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_report_status_idx" ON "community_report" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_vote_post_id_idx" ON "community_vote" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_vote_post_user_unique_idx" ON "community_vote" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_share_link_token_idx" ON "doctor_share_link" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_share_link_user_id_idx" ON "doctor_share_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_user_id_start_time_idx" ON "episode" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_idx" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "solar_activity_timestamp_source_idx" ON "solar_activity_snapshot" USING btree ("timestamp_utc","source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_consent_user_type_idx" ON "user_consent" USING btree ("user_id","consent_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consent_user_id_idx" ON "user_consent" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_customer_id_idx" ON "user" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_community_handle_idx" ON "user" USING btree ("community_handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_weather_settings_user_id_idx" ON "user_weather_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weather_daily_snapshot_lat_lon_date_idx" ON "weather_daily_snapshot" USING btree ("lat","lon","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wpi_snapshot_user_id_timestamp_idx" ON "weather_pain_index_snapshot" USING btree ("user_id","timestamp_local");