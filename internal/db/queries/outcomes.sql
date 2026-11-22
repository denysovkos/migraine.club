-- name: GetOutcomeSettings :one
SELECT * FROM user_outcome_settings WHERE user_id = $1 LIMIT 1;

-- name: InsertOutcomeSettings :exec
INSERT INTO user_outcome_settings (user_id, baseline_start, baseline_end, preferred_window_days, timezone)
VALUES (@user_id, sqlc.narg('baseline_start'), sqlc.narg('baseline_end'), @preferred_window_days, NULL);

-- name: UpdateOutcomeSettings :exec
UPDATE user_outcome_settings SET baseline_start = sqlc.narg('baseline_start'), baseline_end = sqlc.narg('baseline_end'),
  preferred_window_days = @preferred_window_days, timezone = NULL, updated_at = @now
WHERE user_id = @user_id;
