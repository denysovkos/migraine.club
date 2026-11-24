-- name: EpisodesInWindow :many
SELECT id, start_time, end_time, is_ongoing, attack_type, intensity, triggers, protectors
FROM episode
WHERE user_id = @user_id AND start_time < @range_end AND (end_time IS NULL OR end_time >= @range_start)
ORDER BY is_ongoing DESC, start_time ASC;

-- name: DiaryRowsBetween :many
SELECT * FROM daily_diary_entry
WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date
ORDER BY local_date;

-- name: DiaryRowAt :one
SELECT * FROM daily_diary_entry WHERE user_id = @user_id AND local_date = @local_date LIMIT 1;

-- name: IntakeTimesBetween :many
SELECT taken_at FROM medication_intakes WHERE user_id = @user_id AND taken_at >= @range_start AND taken_at < @range_end;

-- name: AcuteDoseTimesBetween :many
SELECT taken_at FROM acute_doses WHERE user_id = @user_id AND taken_at >= @range_start AND taken_at < @range_end;

-- name: HeadacheEpisodesInWindow :many
SELECT id, start_time, end_time, is_ongoing FROM episode
WHERE user_id = @user_id AND attack_type = 'headache' AND start_time < @range_end AND (end_time IS NULL OR end_time >= @range_start);

-- name: PromoteEpisodesToMigraine :exec
UPDATE episode SET attack_type = 'migraine', updated_at = @now WHERE user_id = @user_id AND id = ANY(@ids::int[]);

-- name: UpsertUserDiaryEntry :one
INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, created_from, impact, notes, bed_time_local, wake_time_local, updated_at)
VALUES (@user_id, @local_date, @timezone, @day_type, 'user', @impact, @notes, @bed_time_local, @wake_time_local, @now)
ON CONFLICT (user_id, local_date) DO UPDATE SET
  user_id = EXCLUDED.user_id, local_date = EXCLUDED.local_date, timezone = EXCLUDED.timezone,
  day_type = EXCLUDED.day_type, created_from = 'user', impact = EXCLUDED.impact, notes = EXCLUDED.notes,
  bed_time_local = EXCLUDED.bed_time_local, wake_time_local = EXCLUDED.wake_time_local, updated_at = @now
RETURNING *;

-- name: DayMedicationIntakes :many
SELECT mi.id, mi.taken_at, mi.dose, mi.unit, mi.unit_is_custom, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.taken_at >= @range_start AND mi.taken_at < @range_end
ORDER BY mi.taken_at;

-- name: DayAcuteDoses :many
SELECT d.id, d.taken_at, d.dose, d.unit, d.unit_is_custom, um.custom_name, mc.canonical_name
FROM acute_doses d
JOIN user_medications um ON d.medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE d.user_id = @user_id AND d.taken_at >= @range_start AND d.taken_at < @range_end
ORDER BY d.taken_at;

-- name: DayPreventiveIntakes :many
SELECT e.id, e.plan_id, e.state, e.taken_at, p.name, p.dose_text
FROM preventive_intake_event e
JOIN preventive_plan p ON e.plan_id = p.id
WHERE e.user_id = @user_id AND e.local_date = @local_date;

-- name: SleepAdherenceEventForDay :one
SELECT id FROM program_adherence_event
WHERE enrollment_id = @enrollment_id AND local_date = @local_date AND attack_id IS NULL
LIMIT 1;

-- name: InsertDayAdherenceEvent :exec
INSERT INTO program_adherence_event (enrollment_id, user_id, program_id, local_date, signal, source, payload)
VALUES (@enrollment_id, @user_id, @program_id, @local_date, @signal, @source, @payload);
