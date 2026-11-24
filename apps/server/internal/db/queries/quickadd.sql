-- name: OngoingEpisodeID :one
SELECT id FROM episode WHERE user_id = @user_id AND is_ongoing = true ORDER BY start_time DESC LIMIT 1;

-- name: OngoingEpisodeIDAt :one
SELECT id FROM episode WHERE user_id = @user_id AND is_ongoing = true AND start_time <= @at ORDER BY start_time DESC LIMIT 1;

-- name: TopIntakeMeds :many
SELECT user_medication_id, count(*)::int AS count, max(taken_at)::timestamptz AS last_used_at
FROM medication_intakes
WHERE user_id = @user_id AND taken_at >= @window_start AND user_medication_id IS NOT NULL
GROUP BY user_medication_id
ORDER BY count(*) DESC, max(taken_at) DESC
LIMIT 5;

-- name: UserMedsWithCatalog :many
SELECT um.id, um.default_dose, um.default_unit, um.default_unit_is_custom, um.custom_name, mc.canonical_name
FROM user_medications um
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE um.user_id = @user_id AND um.id = ANY(@ids::uuid[]);

-- name: RecentIntakesForMeds :many
-- The latest 200 intakes of each of the medications, newest first: one
-- query for all the suggestions instead of one per medication.
SELECT user_medication_id::text AS user_medication_id, dose, unit, unit_is_custom, taken_at FROM (
  SELECT user_medication_id, dose, unit, unit_is_custom, taken_at,
    row_number() OVER (PARTITION BY user_medication_id ORDER BY taken_at DESC) AS n
  FROM medication_intakes
  WHERE user_id = @user_id AND user_medication_id = ANY(@ids::uuid[]) AND taken_at >= @window_start
) recent
WHERE n <= 200
ORDER BY user_medication_id, taken_at DESC;

-- name: UserMedForCatalog :one
SELECT id FROM user_medications WHERE user_id = @user_id AND catalog_medication_id = @catalog_medication_id LIMIT 1;

-- name: InsertCatalogUserMed :one
INSERT INTO user_medications (user_id, catalog_medication_id, custom_name, default_dose, default_unit, default_unit_is_custom, is_pinned)
VALUES (@user_id, @catalog_medication_id, NULL, NULL, NULL, false, false)
RETURNING id;

-- name: UserMedForCustomName :one
SELECT id FROM user_medications WHERE user_id = @user_id AND lower(custom_name) = lower(@name::text) LIMIT 1;

-- name: InsertCustomUserMed :one
INSERT INTO user_medications (user_id, catalog_medication_id, custom_name, default_dose, default_unit, default_unit_is_custom, is_pinned)
VALUES (@user_id, NULL, @custom_name, NULL, NULL, false, false)
RETURNING id;

-- name: OwnedUserMed :one
SELECT id, is_acute FROM user_medications WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: OwnedEpisodeID :one
SELECT id FROM episode WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: InsertMedicationIntake :one
INSERT INTO medication_intakes (user_id, user_medication_id, episode_id, taken_at, medication_name, dose, unit, unit_is_custom)
VALUES (@user_id, @user_medication_id, @episode_id, @taken_at, NULL, @dose, @unit, @unit_is_custom)
RETURNING id;

-- name: TouchUserMedLastUsed :exec
UPDATE user_medications SET
  last_used_at = greatest(coalesce(last_used_at, @taken_at), @taken_at),
  last_used_dose = COALESCE(sqlc.narg(dose), last_used_dose),
  last_used_unit = COALESCE(sqlc.narg(unit), last_used_unit),
  last_used_unit_is_custom = CASE WHEN @set_unit_is_custom::bool THEN @unit_is_custom::bool ELSE last_used_unit_is_custom END
WHERE user_id = @user_id AND id = @id;

-- name: OwnedIntakeID :one
SELECT id FROM medication_intakes WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: DeleteIntake :exec
DELETE FROM medication_intakes WHERE user_id = @user_id AND id = @id;

-- name: OwnedAcuteDoseID :one
SELECT id FROM acute_doses WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: PatchIntake :exec
UPDATE medication_intakes SET
  dose = CASE WHEN @set_dose::bool THEN sqlc.narg(dose) ELSE dose END,
  unit = CASE WHEN @set_unit::bool THEN sqlc.narg(unit) ELSE unit END,
  unit_is_custom = CASE WHEN @set_unit_is_custom::bool THEN @unit_is_custom::bool ELSE unit_is_custom END,
  taken_at = COALESCE(sqlc.narg(taken_at), taken_at)
WHERE user_id = @user_id AND id = @id;

-- name: PatchAcuteDose :exec
UPDATE acute_doses SET
  dose = CASE WHEN @set_dose::bool THEN sqlc.narg(dose) ELSE dose END,
  unit = CASE WHEN @set_unit::bool THEN sqlc.narg(unit) ELSE unit END,
  unit_is_custom = CASE WHEN @set_unit_is_custom::bool THEN @unit_is_custom::bool ELSE unit_is_custom END,
  taken_at = COALESCE(sqlc.narg(taken_at), taken_at)
WHERE user_id = @user_id AND id = @id;

-- name: InsertAcuteDose :one
INSERT INTO acute_doses (user_id, medication_id, attack_id, taken_at, dose, unit, unit_is_custom, notes)
VALUES (@user_id, @medication_id, @attack_id, @taken_at, @dose, @unit, @unit_is_custom, @notes)
RETURNING id;

-- name: ListAcuteDoses :many
SELECT id, taken_at, medication_id, attack_id, dose, unit, notes FROM acute_doses
WHERE user_id = @user_id
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR taken_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR taken_at <= sqlc.narg(to_time))
ORDER BY taken_at DESC
LIMIT @lim;

-- name: UpsertDoseOutcome :one
INSERT INTO dose_outcomes (user_id, dose_id, helped, back_to_normal_function, time_to_relief_minutes, notes)
VALUES (@user_id, @dose_id, @helped, @back_to_normal_function, @time_to_relief_minutes, @notes)
ON CONFLICT (dose_id) DO UPDATE SET
  helped = EXCLUDED.helped, back_to_normal_function = EXCLUDED.back_to_normal_function,
  time_to_relief_minutes = EXCLUDED.time_to_relief_minutes, notes = EXCLUDED.notes, updated_at = @now
RETURNING id;
