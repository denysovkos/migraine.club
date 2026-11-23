-- name: MarkInsightsStale :exec
UPDATE insights_cache SET stale = true WHERE user_id = $1;

-- name: LatestInsightsCache :one
SELECT * FROM insights_cache WHERE user_id = @user_id AND window_days = @window_days AND method_version = @method_version
ORDER BY computed_at DESC LIMIT 1;

-- name: UpsertInsightsCache :exec
INSERT INTO insights_cache (user_id, window_days, method_version, computed_at, stale, payload_json, input_stats_json)
VALUES (@user_id, @window_days, @method_version, @computed_at, false, @payload_json, @input_stats_json)
ON CONFLICT (user_id, window_days, method_version) DO UPDATE SET
  computed_at = EXCLUDED.computed_at, stale = false, payload_json = EXCLUDED.payload_json, input_stats_json = EXCLUDED.input_stats_json;

-- name: InsightEpisodes :many
SELECT id, start_time, end_time, is_ongoing FROM episode
WHERE user_id = @user_id AND start_time >= @from_ts AND start_time <= @to_ts;

-- name: InsightFactorEvents :many
SELECT factor_id, occurred_at FROM factor_event
WHERE user_id = @user_id AND occurred_at >= @from_ts AND occurred_at <= @to_ts;

-- name: DiaryDatesBetween :many
SELECT local_date FROM daily_diary_entry WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date;

-- name: FactorsByIDs :many
SELECT id, display_name, type FROM factor WHERE id = ANY(@ids::uuid[]);
