-- name: GetIntakeResponse :one
SELECT * FROM intake_response WHERE user_id = $1 LIMIT 1;

-- name: LockIntakeResponse :one
SELECT * FROM intake_response WHERE user_id = $1 FOR UPDATE;

-- name: UpsertIntakeBlock :exec
INSERT INTO intake_response (user_id, version, status, current_step, answers, seeded)
VALUES (@user_id, @version, @status, @current_step, @answers, '{}')
ON CONFLICT (user_id) DO UPDATE SET answers = EXCLUDED.answers,
  current_step = GREATEST(intake_response.current_step, EXCLUDED.current_step), updated_at = @now;

-- name: UpsertIntakeSkipped :exec
INSERT INTO intake_response (user_id, version, status, current_step, answers, seeded)
VALUES (@user_id, @version, 'skipped', @current_step, @answers, '{}')
ON CONFLICT (user_id) DO UPDATE SET status = 'skipped', updated_at = @now;

-- name: UpsertIntakeCompleted :exec
INSERT INTO intake_response (user_id, version, status, current_step, answers, seeded, completed_at)
VALUES (@user_id, @version, 'completed', @current_step, @answers, @seeded, @completed_at)
ON CONFLICT (user_id) DO UPDATE SET status = 'completed', current_step = EXCLUDED.current_step,
  seeded = EXCLUDED.seeded, completed_at = EXCLUDED.completed_at, updated_at = @now;

-- name: UserMedicationOwnership :many
SELECT id, catalog_medication_id, custom_name FROM user_medications WHERE user_id = $1;

-- name: CatalogTagsByIDs :many
SELECT id, tags FROM medications_catalog WHERE id = ANY(@ids::uuid[]);

-- name: InsertSeededUserMedication :one
INSERT INTO user_medications (user_id, catalog_medication_id, custom_name, default_dose, default_unit,
  default_unit_is_custom, medication_class, is_acute, is_pinned)
VALUES (@user_id, sqlc.narg('catalog_medication_id'), sqlc.narg('custom_name'), sqlc.narg('default_dose'),
  sqlc.narg('default_unit'), @default_unit_is_custom, @medication_class, true, @is_pinned)
RETURNING id;

-- name: InsertIntakeTriggerFactor :many
INSERT INTO factor (user_id, key, type, display_name, is_active)
VALUES (@user_id, @key, 'trigger', @display_name, true)
ON CONFLICT (user_id, key) WHERE key IS NOT NULL DO NOTHING
RETURNING id;
