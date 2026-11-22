-- name: ActiveConsents :many
SELECT * FROM user_consent
WHERE user_id = $1 AND withdrawn_at IS NULL;

-- name: ActiveConsentTypes :many
SELECT consent_type FROM user_consent
WHERE user_id = $1 AND withdrawn_at IS NULL;

-- name: ActiveConsentByType :one
SELECT * FROM user_consent
WHERE user_id = $1 AND consent_type = $2 AND withdrawn_at IS NULL
LIMIT 1;

-- name: RenewConsent :one
UPDATE user_consent
SET version = @version, given_at = @now, ip_address = @ip_address, user_agent = @user_agent, updated_at = @now
WHERE id = @id
RETURNING *;

-- name: InsertConsent :one
INSERT INTO user_consent (user_id, consent_type, version, given_at, ip_address, user_agent)
VALUES (@user_id, @consent_type, @version, @given_at, @ip_address, @user_agent)
RETURNING *;

-- name: WithdrawConsent :many
UPDATE user_consent
SET withdrawn_at = @now, updated_at = @now
WHERE user_id = @user_id AND consent_type = @consent_type AND withdrawn_at IS NULL
RETURNING *;
