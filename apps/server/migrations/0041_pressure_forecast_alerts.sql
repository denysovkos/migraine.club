CREATE TABLE "pressure_forecast_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"points" jsonb NOT NULL,
	"source" text DEFAULT 'openweathermap' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_weather_settings" ADD COLUMN "pressure_drop_threshold_hpa" double precision;--> statement-breakpoint
CREATE UNIQUE INDEX "pressure_forecast_cache_lat_lon_idx" ON "pressure_forecast_cache" USING btree ("lat","lon");