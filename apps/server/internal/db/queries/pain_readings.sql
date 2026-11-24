-- name: ListPainReadings :many
SELECT * FROM episode_pain_reading WHERE user_id = @user_id AND episode_id = @episode_id ORDER BY recorded_at ASC;

-- name: InsertPainReading :one
INSERT INTO episode_pain_reading (user_id, episode_id, recorded_at, intensity)
VALUES (@user_id, @episode_id, @recorded_at, @intensity)
RETURNING *;

-- name: PeakPainReading :one
SELECT COALESCE(max(intensity), 0)::int AS peak FROM episode_pain_reading WHERE user_id = @user_id AND episode_id = @episode_id;

-- name: DeletePainReading :many
DELETE FROM episode_pain_reading WHERE id = @id AND user_id = @user_id AND episode_id = @episode_id RETURNING id;
