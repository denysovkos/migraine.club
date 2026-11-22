-- name: ListAppointmentPreps :many
SELECT * FROM appointment_prep WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100;

-- name: GetAppointmentPrep :one
SELECT * FROM appointment_prep WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: PrepDiaryRows :many
SELECT local_date, day_type FROM daily_diary_entry
WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date LIMIT 200;

-- name: PrepIntakeRows :many
SELECT mi.taken_at, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.taken_at >= @from_ts AND mi.taken_at < @to_ts LIMIT 200;

-- name: PrepQuestionnaires :many
SELECT type, score_total, taken_at FROM questionnaire_responses
WHERE user_id = $1 AND type IN ('HIT6', 'MIDAS') ORDER BY taken_at DESC LIMIT 200;

-- name: PrepPreventiveNames :many
SELECT name FROM preventive_plan WHERE user_id = $1 AND status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 100;

-- name: PrepEpisodeIntensities :many
SELECT intensity FROM episode WHERE user_id = @user_id AND start_time >= @from_ts AND start_time < @to_ts LIMIT 200;

-- name: InsertAppointmentPrep :one
INSERT INTO appointment_prep (user_id, appointment_date, visit_label, clinician_name, visit_reason, top_concerns,
  doctor_questions, personal_notes, compare_window_days, generated_snapshot)
VALUES (@user_id, @appointment_date, sqlc.narg('visit_label'), sqlc.narg('clinician_name'), sqlc.narg('visit_reason'),
  @top_concerns, @doctor_questions, sqlc.narg('personal_notes'), @compare_window_days, @generated_snapshot)
RETURNING id;

-- name: UpdateAppointmentPrep :exec
UPDATE appointment_prep SET
  appointment_date = COALESCE(sqlc.narg('appointment_date'), appointment_date),
  visit_label = CASE WHEN @set_visit_label::boolean THEN sqlc.narg('visit_label') ELSE visit_label END,
  clinician_name = CASE WHEN @set_clinician_name::boolean THEN sqlc.narg('clinician_name') ELSE clinician_name END,
  visit_reason = CASE WHEN @set_visit_reason::boolean THEN sqlc.narg('visit_reason') ELSE visit_reason END,
  top_concerns = COALESCE(sqlc.narg('top_concerns'), top_concerns),
  doctor_questions = COALESCE(sqlc.narg('doctor_questions'), doctor_questions),
  personal_notes = CASE WHEN @set_personal_notes::boolean THEN sqlc.narg('personal_notes') ELSE personal_notes END,
  updated_at = @now
WHERE user_id = @user_id AND id = @id;

-- name: DeleteAppointmentPrep :exec
DELETE FROM appointment_prep WHERE user_id = @user_id AND id = @id;

-- name: ReportEpisodes :many
SELECT id, start_time, end_time, intensity, symptoms, medications FROM episode
WHERE user_id = @user_id AND start_time >= @from_ts AND start_time < @to_ts ORDER BY start_time DESC;

-- name: ReportDiaryRows :many
SELECT local_date, day_type, impact FROM daily_diary_entry
WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date ORDER BY local_date DESC;

-- name: ReportIntakes :many
SELECT mi.episode_id, mi.taken_at, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.taken_at >= @from_ts AND mi.taken_at < @to_ts;

-- name: ReportPreventives :many
SELECT name, status FROM preventive_plan WHERE user_id = @user_id AND created_at < @before ORDER BY created_at DESC LIMIT 100;

-- name: ReportQuestionnaires :many
SELECT type, score_total, taken_at FROM questionnaire_responses WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 200;

-- name: ReportUserName :one
SELECT display_name FROM "user" WHERE id = $1 LIMIT 1;

-- name: ReportBleedingRows :many
SELECT local_date, bleeding FROM cycle_bleeding_day WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date;

-- name: ReportMigraineDays :many
SELECT local_date FROM daily_diary_entry
WHERE user_id = @user_id AND day_type = 'migraine_day' AND local_date >= @from_date AND local_date <= @to_date;

-- name: ReportCycleAttacks :many
SELECT start_time, attack_type FROM episode WHERE user_id = @user_id AND start_time >= @from_ts AND start_time < @to_ts;
