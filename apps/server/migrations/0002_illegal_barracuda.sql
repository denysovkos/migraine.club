CREATE TABLE IF NOT EXISTS "solar_activity_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp_utc" timestamp with time zone NOT NULL,
	"kp_index" double precision NOT NULL,
	"source" text DEFAULT 'noaa' NOT NULL,
	"raw" jsonb,
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
ALTER TABLE "episode" ADD COLUMN IF NOT EXISTS "weather_pain_index_id" uuid;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN IF NOT EXISTS "weather_context" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "solar_activity_timestamp_source_idx" ON "solar_activity_snapshot" USING btree ("timestamp_utc","source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_weather_settings_user_id_idx" ON "user_weather_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weather_daily_snapshot_lat_lon_date_idx" ON "weather_daily_snapshot" USING btree ("lat","lon","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wpi_snapshot_user_id_timestamp_idx" ON "weather_pain_index_snapshot" USING btree ("user_id","timestamp_local");