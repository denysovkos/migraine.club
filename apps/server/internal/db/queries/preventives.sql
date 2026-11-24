-- name: ListPreventivePlans :many
SELECT * FROM preventive_plan WHERE user_id = $1 ORDER BY created_at DESC;

-- name: CreatePreventivePlan :one
INSERT INTO preventive_plan (user_id, catalog_medication_id, name, kind, dose_text, schedule_type, schedule_payload,
  start_date, reminder_times, reminders_enabled, status, paused_at, stopped_at, stop_reason, stop_reason_note)
VALUES (@user_id, sqlc.narg('catalog_medication_id'), @name, @kind, sqlc.narg('dose_text'), @schedule_type, @schedule_payload,
  @start_date, @reminder_times, @reminders_enabled, 'active', NULL, NULL, NULL, NULL)
RETURNING id;

-- name: GetPreventivePlan :one
SELECT * FROM preventive_plan WHERE user_id = @user_id AND id = @id LIMIT 1;

-- name: UpdatePreventivePlan :exec
UPDATE preventive_plan SET
  name = COALESCE(sqlc.narg('name'), name),
  kind = COALESCE(sqlc.narg('kind'), kind),
  dose_text = CASE WHEN @set_dose_text::boolean THEN sqlc.narg('dose_text') ELSE dose_text END,
  schedule_type = COALESCE(sqlc.narg('schedule_type'), schedule_type),
  schedule_payload = CASE WHEN @set_schedule_payload::boolean THEN @schedule_payload::jsonb ELSE schedule_payload END,
  start_date = COALESCE(sqlc.narg('start_date'), start_date),
  reminder_times = COALESCE(sqlc.narg('reminder_times'), reminder_times),
  reminders_enabled = COALESCE(sqlc.narg('reminders_enabled'), reminders_enabled),
  updated_at = @now
WHERE user_id = @user_id AND id = @id;

-- name: SetPreventivePlanStatus :exec
UPDATE preventive_plan SET status = @status, paused_at = sqlc.narg('paused_at'), stopped_at = sqlc.narg('stopped_at'),
  stop_reason = sqlc.narg('stop_reason'), stop_reason_note = sqlc.narg('stop_reason_note'), updated_at = @now
WHERE user_id = @user_id AND id = @id;

-- name: InsertPreventiveStatusChange :exec
INSERT INTO preventive_status_change (user_id, plan_id, from_status, to_status, changed_at, reason, reason_note)
VALUES (@user_id, @plan_id, @from_status, @to_status, @changed_at, sqlc.narg('reason'), sqlc.narg('reason_note'));

-- name: DeletePreventivePlan :exec
DELETE FROM preventive_plan WHERE user_id = @user_id AND id = @id;

-- name: UpsertPreventiveIntake :exec
INSERT INTO preventive_intake_event (user_id, plan_id, local_date, state, taken_at, note, created_at)
VALUES (@user_id, @plan_id, @local_date, @state, sqlc.narg('taken_at'), sqlc.narg('note'), @created_at)
ON CONFLICT (plan_id, local_date) DO UPDATE SET
  user_id = EXCLUDED.user_id, plan_id = EXCLUDED.plan_id, local_date = EXCLUDED.local_date, state = EXCLUDED.state,
  taken_at = EXCLUDED.taken_at, note = EXCLUDED.note, created_at = EXCLUDED.created_at;

-- name: UpsertPreventiveWeeklyCheckIn :exec
INSERT INTO preventive_weekly_check_in (user_id, plan_id, week_start_local_date, side_effects, still_taking, note, created_at)
VALUES (@user_id, @plan_id, @week_start, @side_effects, @still_taking, sqlc.narg('note'), @created_at)
ON CONFLICT (plan_id, week_start_local_date) DO UPDATE SET
  side_effects = EXCLUDED.side_effects, still_taking = EXCLUDED.still_taking, note = EXCLUDED.note;

-- name: ActivePreventivePlans :many
SELECT * FROM preventive_plan WHERE user_id = $1 AND status = 'active' ORDER BY created_at;

-- name: ActivePreventivePlansUnordered :many
SELECT * FROM preventive_plan WHERE user_id = $1 AND status = 'active';

-- name: PreventiveIntakesForPlans :many
SELECT plan_id, local_date, state FROM preventive_intake_event
WHERE user_id = @user_id AND plan_id = ANY(@plan_ids::uuid[]) AND local_date >= @from_date AND local_date <= @to_date;

-- name: PreventiveIntakesForPlan :many
SELECT local_date, state FROM preventive_intake_event
WHERE user_id = @user_id AND plan_id = @plan_id AND local_date >= @from_date AND local_date <= @to_date;

-- name: DiaryDayTypesBetween :many
SELECT local_date, day_type FROM daily_diary_entry WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date;

-- name: MedicationIntakeNamesBetween :many
SELECT mi.taken_at, mi.medication_name, um.custom_name, mc.canonical_name
FROM medication_intakes mi
LEFT JOIN user_medications um ON mi.user_medication_id = um.id
LEFT JOIN medications_catalog mc ON um.catalog_medication_id = mc.id
WHERE mi.user_id = @user_id AND mi.taken_at >= @from_ts AND mi.taken_at < @to_ts;
