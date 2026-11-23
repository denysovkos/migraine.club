-- name: GetProgramSettings :one
SELECT * FROM program_settings WHERE user_id = $1 LIMIT 1;

-- name: UpsertProgramSettings :exec
INSERT INTO program_settings (user_id, enabled, notifications_config) VALUES (@user_id, @enabled, @notifications_config)
ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, notifications_config = EXCLUDED.notifications_config, updated_at = @now;

-- name: InsertEnrollment :one
INSERT INTO program_enrollment (user_id, program_id, status, target_payload, start_date, baseline_window_start,
  baseline_window_end, evaluation_window_start, evaluation_window_end, ramp_days, timezone)
VALUES (@user_id, @program_id, 'active', @target_payload, @start_date, @baseline_window_start, @baseline_window_end,
  @evaluation_window_start, @evaluation_window_end, @ramp_days, @timezone)
RETURNING *;

-- name: SetEnrollmentStatus :one
UPDATE program_enrollment SET status = @status,
  end_date = CASE WHEN @set_end::boolean THEN sqlc.narg('end_date') ELSE end_date END, updated_at = @now
WHERE id = @id AND user_id = @user_id
RETURNING *;

-- name: ListEnrollments :many
SELECT * FROM program_enrollment WHERE user_id = $1;

-- name: DismissRecommendation :exec
INSERT INTO program_recommendation_dismissal (user_id, program_id) VALUES (@user_id, @program_id)
ON CONFLICT (user_id, program_id) DO UPDATE SET dismissed_at = @now;

-- name: ActiveDismissals :many
SELECT program_id FROM program_recommendation_dismissal WHERE user_id = @user_id AND dismissed_at >= @cutoff;

-- name: DiaryDayTypesOnly :many
SELECT day_type FROM daily_diary_entry WHERE user_id = @user_id AND local_date >= @from_date AND local_date <= @to_date;

-- name: FactorEventKeysSince :many
SELECT f.key, e.occurred_at FROM factor_event e INNER JOIN factor f ON e.factor_id = f.id
WHERE e.user_id = @user_id AND e.occurred_at >= @since;

-- name: EpisodeOnsetsSince :many
SELECT id, start_time, onset_at FROM episode WHERE user_id = @user_id AND start_time >= @since AND start_time IS NOT NULL;

-- name: AcuteDosesSince :many
SELECT taken_at, attack_id FROM acute_doses WHERE user_id = @user_id AND taken_at >= @since;

-- name: IntakeAnswersStatus :one
SELECT answers, status FROM intake_response WHERE user_id = $1 LIMIT 1;

-- name: AdherenceSignals :many
SELECT signal FROM program_adherence_event
WHERE enrollment_id = @enrollment_id AND ((@per_attack::boolean AND attack_id IS NOT NULL) OR (NOT @per_attack::boolean AND attack_id IS NULL));

-- name: TodayAdherenceEvent :one
SELECT signal, payload FROM program_adherence_event
WHERE enrollment_id = @enrollment_id AND local_date = @local_date AND attack_id IS NULL LIMIT 1;
