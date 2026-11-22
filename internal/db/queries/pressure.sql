-- name: PressureForecastCache :one
SELECT * FROM pressure_forecast_cache WHERE lat = @lat AND lon = @lon LIMIT 1;

-- name: UpsertPressureForecastCache :exec
INSERT INTO pressure_forecast_cache (lat, lon, points, fetched_at) VALUES (@lat, @lon, @points, @fetched_at)
ON CONFLICT (lat, lon) DO UPDATE SET points = EXCLUDED.points, fetched_at = EXCLUDED.fetched_at;

-- name: SetPressureThreshold :many
UPDATE user_weather_settings SET pressure_drop_threshold_hpa = sqlc.narg('threshold'), updated_at = @now
WHERE user_id = @user_id RETURNING id;

-- name: AlertsColumnExists :one
SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name = 'user_weather_settings' AND column_name = 'alerts_enabled') AS exists;

-- name: SetAlertsEnabled :exec
UPDATE user_weather_settings SET alerts_enabled = @alerts_enabled, updated_at = @now WHERE user_id = @user_id;
