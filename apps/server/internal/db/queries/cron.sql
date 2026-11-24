-- name: AcquireCronLease :many
INSERT INTO cron_run_lock (job_name, run_id, locked_at, expires_at) VALUES (@job_name, @run_id, @now, @expires_at)
ON CONFLICT (job_name) DO UPDATE SET run_id = EXCLUDED.run_id, locked_at = EXCLUDED.locked_at, expires_at = EXCLUDED.expires_at
WHERE cron_run_lock.expires_at < @now
RETURNING run_id;

-- name: ReleaseCronLease :exec
UPDATE cron_run_lock SET expires_at = now() WHERE job_name = @job_name AND run_id = @run_id;
