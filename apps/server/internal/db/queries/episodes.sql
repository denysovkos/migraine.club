-- name: HasHealthDataConsentRow :one
SELECT EXISTS (
  SELECT 1 FROM user_consent
  WHERE user_id = $1 AND consent_type = 'health_data' AND withdrawn_at IS NULL
) AS ok;

-- name: OngoingEpisode :one
SELECT id, attack_type, start_time FROM episode
WHERE user_id = $1 AND is_ongoing = true
LIMIT 1;

-- name: EndEpisodeAt :exec
UPDATE episode SET is_ongoing = false, end_time = @end_time, updated_at = @now
WHERE user_id = @user_id AND id = @id;

-- name: InsertEpisode :one
INSERT INTO episode (
  user_id, start_time, onset_at, end_time, is_ongoing, attack_type, intensity,
  pain_location, pain_location_other, pain_type, pain_type_other, symptoms, symptoms_other,
  medications, triggers, protectors, triggers_other, notes, weather_pain_index_id, weather_context
) VALUES (
  @user_id, @start_time, @onset_at, @end_time, @is_ongoing, @attack_type, @intensity,
  @pain_location, @pain_location_other, @pain_type, @pain_type_other, @symptoms, @symptoms_other,
  '[]'::jsonb, @triggers, @protectors, @triggers_other, @notes, @weather_pain_index_id, @weather_context
)
RETURNING *;

-- name: GetEpisode :one
SELECT * FROM episode WHERE id = @id AND user_id = @user_id LIMIT 1;

-- name: GetEpisodeAnyUser :one
SELECT id, user_id, start_time, end_time, is_ongoing FROM episode WHERE id = $1 LIMIT 1;

-- name: UpdateEpisode :one
UPDATE episode SET
  attack_type = @attack_type, start_time = @start_time, onset_at = @onset_at, end_time = @end_time,
  is_ongoing = @is_ongoing, intensity = @intensity, pain_location = @pain_location,
  pain_location_other = @pain_location_other, pain_type = @pain_type, pain_type_other = @pain_type_other,
  symptoms = @symptoms, symptoms_other = @symptoms_other, triggers = @triggers, protectors = @protectors,
  triggers_other = @triggers_other, notes = @notes, updated_at = @now
WHERE id = @id AND user_id = @user_id
RETURNING *;

-- name: DeleteEpisode :exec
DELETE FROM episode WHERE id = @id AND user_id = @user_id;

-- name: ListEpisodes :many
SELECT * FROM episode
WHERE user_id = @user_id
  AND (sqlc.narg(from_time)::timestamp IS NULL OR start_time >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamp IS NULL OR start_time <= sqlc.narg(to_time))
ORDER BY start_time DESC
LIMIT @lim::bigint OFFSET @off::bigint;

-- name: CountEpisodes :one
SELECT count(*)::int FROM episode
WHERE user_id = @user_id
  AND (sqlc.narg(from_time)::timestamp IS NULL OR start_time >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamp IS NULL OR start_time <= sqlc.narg(to_time));

-- name: RecentEpisodes :many
SELECT * FROM episode WHERE user_id = $1 ORDER BY start_time DESC LIMIT $2;

-- name: EpisodeMedicationIntakes :many
SELECT mi.id, mi.taken_at, mi.dose, mi.unit, mi.unit_is_custom, mi.medication_name,
       um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.episode_id = @episode_id
ORDER BY mi.taken_at DESC;

-- name: AttackDoses :many
SELECT d.id AS dose_id, d.medication_id, um.custom_name AS medication_label, mc.canonical_name,
       um.medication_class, d.taken_at, d.dose, d.unit, d.unit_is_custom, d.notes,
       o.helped AS outcome_helped, o.back_to_normal_function, o.time_to_relief_minutes,
       o.notes AS outcome_notes, o.updated_at AS outcome_updated_at
FROM acute_doses d
JOIN user_medications um ON d.medication_id = um.id
LEFT JOIN dose_outcomes o ON d.id = o.dose_id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE d.user_id = @user_id
  AND ((d.taken_at >= @start_time AND d.taken_at < @effective_end) OR d.attack_id = @attack_id)
ORDER BY d.taken_at ASC;
