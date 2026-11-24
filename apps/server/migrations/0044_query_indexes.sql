DROP INDEX "daily_diary_entry_user_id_local_date_idx";--> statement-breakpoint
CREATE INDEX "solar_activity_source_timestamp_idx" ON "solar_activity_snapshot" USING btree ("source","timestamp_utc");--> statement-breakpoint
CREATE INDEX "wpi_snapshot_user_id_created_at_idx" ON "weather_pain_index_snapshot" USING btree ("user_id","created_at");