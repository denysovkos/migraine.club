-- name: InsertReliefSession :one
INSERT INTO relief_session (user_id, episode_id, exercise, started_at, duration_seconds, completed, helped)
VALUES (@user_id, @episode_id, @exercise, @started_at, @duration_seconds, @completed, @helped)
RETURNING *;

-- name: ListReliefSessions :many
SELECT * FROM relief_session
WHERE user_id = @user_id AND (sqlc.narg(episode_id)::int IS NULL OR episode_id = sqlc.narg(episode_id))
ORDER BY started_at DESC
LIMIT 100;
