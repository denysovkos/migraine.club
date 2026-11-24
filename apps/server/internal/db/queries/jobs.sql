-- name: ClaimStaleEpisodes :many
UPDATE episode SET stale_reminder_sent_at = @sent_at, stale_reminder_count = stale_reminder_count + 1, updated_at = @updated_at
WHERE episode.end_time IS NULL AND episode.start_time < @cutoff AND episode.stale_reminder_sent_at IS NULL
  AND episode.id IN (SELECT e.id FROM episode e WHERE e.end_time IS NULL AND e.start_time < @cutoff AND e.stale_reminder_sent_at IS NULL LIMIT @lim)
RETURNING episode.id, episode.user_id, episode.start_time;

-- name: UserLanguages :many
SELECT id, preferred_language FROM "user" WHERE id = ANY(@ids::text[]);

-- name: ReminderPlans :many
SELECT id, user_id, name, dose_text, schedule_type, schedule_payload, start_date, reminder_times
FROM preventive_plan WHERE status = 'active' AND reminders_enabled = true;

-- name: PlanIntakeState :one
SELECT state FROM preventive_intake_event WHERE plan_id = @plan_id AND local_date = @local_date LIMIT 1;

-- name: SentReminderSlots :many
SELECT time_slot FROM preventive_reminder_log
WHERE plan_id = @plan_id AND local_date = @local_date AND time_slot = ANY(@slots::text[]);

-- name: LogReminder :exec
INSERT INTO preventive_reminder_log (user_id, plan_id, local_date, time_slot) VALUES (@user_id, @plan_id, @local_date, @time_slot)
ON CONFLICT DO NOTHING;

-- name: ActiveEnrollmentsWithConfig :many
SELECT sqlc.embed(e), s.notifications_config
FROM program_enrollment e LEFT JOIN program_settings s ON e.user_id = s.user_id
WHERE e.status = 'active' AND (sqlc.narg('program_id')::text IS NULL OR e.program_id = sqlc.narg('program_id'));

-- name: NotificationSentOn :one
SELECT EXISTS (SELECT 1 FROM program_notification_log WHERE user_id = @user_id AND program_id = @program_id
  AND kind = @kind AND local_date = @local_date) AS sent;

-- name: NotificationSentForAttack :one
SELECT EXISTS (SELECT 1 FROM program_notification_log WHERE user_id = @user_id AND kind = @kind AND attack_id = @attack_id) AS sent;

-- name: LogProgramNotification :exec
INSERT INTO program_notification_log (user_id, program_id, kind, local_date, attack_id)
VALUES (@user_id, @program_id, @kind, @local_date, sqlc.narg('attack_id'));

-- name: OngoingAttacksSince :many
SELECT id, start_time, onset_at FROM episode WHERE user_id = @user_id AND is_ongoing = true AND start_time >= @since;

-- name: AttackHasDose :one
SELECT EXISTS (SELECT 1 FROM acute_doses WHERE user_id = @user_id AND attack_id = @attack_id) AS has;

-- name: ActiveConsentUsers :many
SELECT DISTINCT user_id FROM user_consent WHERE consent_type = 'health_data' AND withdrawn_at IS NULL LIMIT $1;

-- name: AlertEnabledUsers :many
SELECT w.user_id, w.lat, w.lon, w.timezone, u.preferred_language FROM user_weather_settings w
JOIN "user" u ON u.id = w.user_id WHERE w.alerts_enabled = true AND w.timezone IS NOT NULL;

-- name: PressureThresholdUsers :many
SELECT w.user_id, w.lat, w.lon, w.timezone, w.pressure_drop_threshold_hpa, u.preferred_language FROM user_weather_settings w
JOIN "user" u ON u.id = w.user_id WHERE w.pressure_drop_threshold_hpa IS NOT NULL AND w.timezone IS NOT NULL;

-- name: InsertRiskAlertRun :many
INSERT INTO risk_alert_run (user_id, local_date, type, status) VALUES (@user_id, @local_date, @type, 'skipped')
ON CONFLICT DO NOTHING RETURNING id;

-- name: UpdateRiskAlertRun :exec
UPDATE risk_alert_run SET status = @status, details = @details WHERE user_id = @user_id AND local_date = @local_date AND type = @type;

-- name: LatestGfzRaw :one
SELECT raw FROM solar_activity_snapshot WHERE source = 'gfz' ORDER BY timestamp_utc DESC LIMIT 1;
