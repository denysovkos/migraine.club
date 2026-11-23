-- name: OutcomeSettingsTimezone :one
SELECT timezone FROM user_outcome_settings WHERE user_id = $1 LIMIT 1;

-- name: WeatherSettingsTimezone :one
SELECT timezone FROM user_weather_settings WHERE user_id = $1 LIMIT 1;
