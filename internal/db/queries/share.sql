-- name: InsertShareLink :one
INSERT INTO doctor_share_link (user_id, token, label, recipient_name, patient_display_name, expires_at,
  date_range_start, date_range_end, appointment_prep_id)
VALUES (@user_id, @token, sqlc.narg('label'), sqlc.narg('recipient_name'), sqlc.narg('patient_display_name'), @expires_at,
  sqlc.narg('date_range_start'), sqlc.narg('date_range_end'), sqlc.narg('appointment_prep_id'))
RETURNING *;

-- name: ListShareLinks :many
SELECT id, token, label, recipient_name, expires_at, access_count, last_accessed_at, is_revoked, created_at
FROM doctor_share_link WHERE user_id = $1 ORDER BY created_at DESC;

-- name: RevokeShareLink :many
UPDATE doctor_share_link SET is_revoked = true, updated_at = @now
WHERE id = @id AND user_id = @user_id RETURNING id;

-- name: ShareLinkByToken :one
SELECT * FROM doctor_share_link WHERE token = $1 LIMIT 1;

-- name: TouchShareLink :exec
UPDATE doctor_share_link SET access_count = access_count + 1, last_accessed_at = @now, updated_at = @now
WHERE id = @id;

-- name: UserPreferredLanguage :one
SELECT preferred_language FROM "user" WHERE id = $1 LIMIT 1;

-- name: SharePrep :one
SELECT appointment_date, visit_label, clinician_name, visit_reason, top_concerns, doctor_questions,
  personal_notes, generated_snapshot
FROM appointment_prep WHERE id = @id AND user_id = @user_id LIMIT 1;

-- name: ShareEpisodes :many
SELECT * FROM episode
WHERE user_id = @user_id
  AND (sqlc.narg('start')::timestamp IS NULL OR start_time >= sqlc.narg('start'))
  AND (sqlc.narg('end')::timestamp IS NULL OR start_time <= sqlc.narg('end'))
ORDER BY start_time DESC;

-- name: ShareIntakes :many
SELECT mi.episode_id, mi.taken_at, mi.dose, mi.unit, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.episode_id = ANY(@episode_ids::int[])
ORDER BY mi.taken_at DESC;

-- name: ShareMedicationNames :many
SELECT mi.taken_at, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.taken_at >= @from_time AND mi.taken_at < @to_time;

-- name: ShareQuestionnaires :many
SELECT id, type, taken_at, score_total, score_details FROM questionnaire_responses
WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 200;
