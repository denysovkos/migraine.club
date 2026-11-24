-- name: GetCycleSettings :one
SELECT * FROM cycle_settings WHERE user_id = $1 LIMIT 1;

-- name: UpsertCycleSettings :one
INSERT INTO cycle_settings (user_id, enabled, include_in_exports, privacy_mode, perimenstrual_window_start_days, perimenstrual_window_end_days, hormone_profile, updated_at)
VALUES (@user_id, @enabled, @include_in_exports, @privacy_mode, @start_days, @end_days, @hormone_profile, @now)
ON CONFLICT (user_id) DO UPDATE SET
  enabled = EXCLUDED.enabled, include_in_exports = EXCLUDED.include_in_exports, privacy_mode = EXCLUDED.privacy_mode,
  perimenstrual_window_start_days = EXCLUDED.perimenstrual_window_start_days,
  perimenstrual_window_end_days = EXCLUDED.perimenstrual_window_end_days,
  hormone_profile = EXCLUDED.hormone_profile, updated_at = @now
RETURNING *;

-- name: GetBleedingDay :one
SELECT * FROM cycle_bleeding_day WHERE user_id = @user_id AND local_date = @local_date LIMIT 1;

-- name: UpsertBleedingDay :one
INSERT INTO cycle_bleeding_day (user_id, local_date, bleeding, flow, source, updated_at)
VALUES (@user_id, @local_date, @bleeding, @flow, 'user', @now)
ON CONFLICT (user_id, local_date) DO UPDATE SET bleeding = EXCLUDED.bleeding, flow = EXCLUDED.flow, updated_at = @now
RETURNING *;

-- name: DeleteBleedingDay :exec
DELETE FROM cycle_bleeding_day WHERE user_id = @user_id AND local_date = @local_date;

-- name: BleedingDaysBetween :many
SELECT * FROM cycle_bleeding_day WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date ORDER BY local_date ASC;

-- name: MigraineDiaryDaysBetween :many
SELECT local_date FROM daily_diary_entry WHERE user_id = @user_id AND day_type = 'migraine_day' AND local_date >= @from_date AND local_date <= @to_date;

-- name: BleedingDates :many
SELECT local_date FROM cycle_bleeding_day WHERE user_id = $1 AND bleeding = true ORDER BY local_date ASC;

-- name: MigraineStartsBetween :many
SELECT start_time FROM episode WHERE user_id = @user_id AND attack_type = 'migraine' AND start_time >= @range_start AND start_time < @range_end;

-- name: DeleteAllBleedingDays :exec
DELETE FROM cycle_bleeding_day WHERE user_id = $1;

-- name: DeleteCycleSettings :exec
DELETE FROM cycle_settings WHERE user_id = $1;
