-- name: EpisodesTouchingRange :many
SELECT id, start_time, end_time, is_ongoing, attack_type
FROM episode
WHERE user_id = @user_id
  AND start_time < @range_end
  AND (end_time IS NULL OR end_time >= @range_start);

-- name: DiaryRowsForDates :many
SELECT * FROM daily_diary_entry
WHERE user_id = @user_id AND local_date = ANY(@local_dates::date[]);

-- name: UpsertAttackDiaryDay :exec
INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, created_from)
VALUES (@user_id, @local_date, @timezone, @day_type, @insert_created_from)
ON CONFLICT (user_id, local_date) DO UPDATE SET
  timezone = EXCLUDED.timezone,
  day_type = EXCLUDED.day_type,
  created_from = CASE WHEN daily_diary_entry.created_from = 'user' THEN 'user' ELSE @conflict_created_from::text END,
  updated_at = @now;

-- name: DeleteDiaryDay :exec
DELETE FROM daily_diary_entry WHERE user_id = @user_id AND local_date = @local_date;
