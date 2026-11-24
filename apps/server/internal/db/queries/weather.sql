-- name: GetWeatherSettings :one
SELECT * FROM user_weather_settings WHERE user_id = $1 LIMIT 1;

-- name: UpsertWeatherSettings :one
INSERT INTO user_weather_settings (user_id, lat, lon, location_label, timezone, units)
VALUES (@user_id, @lat, @lon, @location_label, @timezone, @units)
ON CONFLICT (user_id) DO UPDATE SET
  lat = EXCLUDED.lat, lon = EXCLUDED.lon, location_label = EXCLUDED.location_label,
  timezone = EXCLUDED.timezone, units = EXCLUDED.units, updated_at = @now
RETURNING *;

-- name: WeatherSnapshotAt :one
SELECT * FROM weather_daily_snapshot WHERE lat = @lat AND lon = @lon AND date = @date LIMIT 1;

-- name: UpsertWeatherSnapshot :one
INSERT INTO weather_daily_snapshot (lat, lon, date, source, delta_pressure, temperature_deviation, avg_humidity, avg_wind_speed, uvi, raw)
VALUES (@lat, @lon, @date, 'openweathermap', @delta_pressure, @temperature_deviation, @avg_humidity, @avg_wind_speed, @uvi, NULL)
ON CONFLICT (lat, lon, date) DO UPDATE SET
  delta_pressure = EXCLUDED.delta_pressure, temperature_deviation = EXCLUDED.temperature_deviation,
  avg_humidity = EXCLUDED.avg_humidity, avg_wind_speed = EXCLUDED.avg_wind_speed, uvi = EXCLUDED.uvi,
  updated_at = @now
RETURNING id;

-- name: WeatherSnapshotByID :one
SELECT * FROM weather_daily_snapshot WHERE id = $1 LIMIT 1;

-- name: LatestWpiSnapshot :one
SELECT * FROM weather_pain_index_snapshot WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: InsertWpiSnapshot :one
INSERT INTO weather_pain_index_snapshot (user_id, timestamp_local, lat, lon, weather_snapshot_id, solar_snapshot_id, wpi_score, wpi_level, components)
VALUES (@user_id, @timestamp_local, @lat, @lon, @weather_snapshot_id, @solar_snapshot_id, @wpi_score, @wpi_level, @components)
RETURNING id;

-- name: WpiHistory :many
SELECT timestamp_local, wpi_score, wpi_level, solar_snapshot_id
FROM weather_pain_index_snapshot WHERE user_id = $1 ORDER BY timestamp_local DESC;

-- name: LatestNoaaKp :one
SELECT * FROM solar_activity_snapshot WHERE source = 'noaa' ORDER BY timestamp_utc DESC LIMIT 1;
