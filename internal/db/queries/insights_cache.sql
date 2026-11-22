-- name: MarkInsightsStale :exec
UPDATE insights_cache SET stale = true WHERE user_id = $1;
