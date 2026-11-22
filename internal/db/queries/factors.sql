-- name: ActiveFactorID :one
SELECT id FROM factor WHERE user_id = @user_id AND display_name = @display_name AND type = @type AND is_active = true LIMIT 1;

-- name: InsertFactor :one
INSERT INTO factor (user_id, key, type, display_name, is_active) VALUES (@user_id, NULL, @type, @display_name, true) RETURNING id;

-- name: InsertFactorEvent :one
INSERT INTO factor_event (user_id, factor_id, occurred_at, source, intensity) VALUES (@user_id, @factor_id, @occurred_at, 'diary', NULL)
RETURNING id, occurred_at;

-- name: RecentFactors :many
SELECT f.id AS factor_id, f.display_name, f.type, f.key, rf.last_occurred_at::timestamptz AS last_occurred_at
FROM factor f
JOIN (SELECT fe.factor_id, max(fe.occurred_at) AS last_occurred_at FROM factor_event fe WHERE fe.user_id = @user_id GROUP BY fe.factor_id) rf
  ON f.id = rf.factor_id
WHERE f.user_id = @user_id AND f.type IN ('trigger', 'protector')
ORDER BY rf.last_occurred_at DESC
LIMIT 25;

-- name: LoggedFactorsBetween :many
SELECT f.type, f.key, f.display_name
FROM factor_event e JOIN factor f ON e.factor_id = f.id
WHERE e.user_id = @user_id AND f.user_id = @user_id AND f.type IN ('trigger', 'protector')
  AND e.occurred_at >= @range_start AND e.occurred_at < @range_end;
