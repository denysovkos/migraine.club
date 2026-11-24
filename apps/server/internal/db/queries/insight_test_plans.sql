-- name: ListInsightTestPlans :many
SELECT p.*, f.display_name AS factor_name, f.type AS factor_type
FROM insight_test_plan p LEFT JOIN factor f ON p.factor_id = f.id
WHERE p.user_id = @user_id AND (sqlc.narg('status')::text IS NULL OR p.status = sqlc.narg('status'))
ORDER BY p.created_at;

-- name: InsertInsightTestPlan :one
INSERT INTO insight_test_plan (user_id, factor_id, direction, start_date, duration_days, notes, reminder_enabled, status, updated_at)
VALUES (@user_id, @factor_id, @direction, @start_date, @duration_days, sqlc.narg('notes'), @reminder_enabled, 'active', @now)
RETURNING id;

-- name: UpdateInsightTestPlan :exec
UPDATE insight_test_plan SET
  status = COALESCE(sqlc.narg('status'), status),
  completed_at = CASE WHEN @set_completed::boolean THEN @now ELSE completed_at END,
  notes = CASE WHEN @set_notes::boolean THEN sqlc.narg('notes') ELSE notes END,
  reminder_enabled = COALESCE(sqlc.narg('reminder_enabled'), reminder_enabled),
  updated_at = @now
WHERE user_id = @user_id AND id = @id;

-- name: EpisodeStartsBetween :many
SELECT start_time FROM episode WHERE user_id = @user_id AND start_time >= @from_ts AND start_time <= @to_ts;
