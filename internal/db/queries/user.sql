-- name: GetUser :one
SELECT * FROM "user" WHERE id = $1 LIMIT 1;

-- name: SetUserDisplayName :one
UPDATE "user" SET display_name = @display_name, updated_at = @now
WHERE id = @id
RETURNING *;

-- name: InsertUserIfMissing :many
INSERT INTO "user" (id, display_name, preferred_language)
VALUES (@id, @display_name, @preferred_language)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: UpdateUserProfile :many
UPDATE "user" SET
  display_name = COALESCE(sqlc.narg(display_name), display_name),
  preferred_language = COALESCE(sqlc.narg(preferred_language), preferred_language),
  theme_preference = COALESCE(sqlc.narg(theme_preference), theme_preference),
  updated_at = @now
WHERE id = @id
RETURNING *;
