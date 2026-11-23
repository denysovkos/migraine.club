-- name: ReserveIdempotencyKey :many
INSERT INTO idempotent_request (user_id, idempotency_key, route)
VALUES (@user_id, @idempotency_key, @route)
ON CONFLICT DO NOTHING
RETURNING id;

-- name: GetIdempotentResponse :one
SELECT response_status, response_body FROM idempotent_request
WHERE user_id = @user_id AND idempotency_key = @idempotency_key
LIMIT 1;

-- name: TakeOverIdempotencyKey :many
UPDATE idempotent_request SET created_at = @now, route = @route
WHERE user_id = @user_id AND idempotency_key = @idempotency_key
  AND response_status IS NULL AND created_at < @stale_before
RETURNING id;

-- name: CompleteIdempotencyKey :exec
UPDATE idempotent_request SET response_status = @response_status, response_body = @response_body
WHERE user_id = @user_id AND idempotency_key = @idempotency_key;

-- name: ReleaseIdempotencyKey :exec
DELETE FROM idempotent_request
WHERE user_id = @user_id AND idempotency_key = @idempotency_key AND response_status IS NULL;
