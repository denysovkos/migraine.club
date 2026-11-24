-- name: UpsertPushSubscription :one
INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, expiration_time, user_agent)
VALUES (@user_id, @endpoint, @p256dh, @auth, CAST(sqlc.narg('expiration_time')::text AS bigint), sqlc.narg('user_agent'))
ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
  expiration_time = EXCLUDED.expiration_time, user_agent = EXCLUDED.user_agent, updated_at = @now
RETURNING id;

-- name: DeleteOwnPushSubscription :execrows
DELETE FROM push_subscription WHERE endpoint = @endpoint AND user_id = @user_id;

-- name: DeletePushSubscriptionsAt :exec
DELETE FROM push_subscription WHERE endpoint = $1;

-- name: UserPushSubscriptions :many
SELECT * FROM push_subscription WHERE user_id = $1;
