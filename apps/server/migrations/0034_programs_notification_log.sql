-- Programs Phase 3: notification dedup log

CREATE TABLE program_notification_log (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  program_id text NOT NULL,
  kind text NOT NULL,
  local_date date NOT NULL,
  attack_id integer REFERENCES episode(id) ON DELETE CASCADE,
  sent_at timestamp NOT NULL DEFAULT now(),
  CHECK (kind IN ('wind_down', 'morning_check_in', 'onset_nudge', 'weekly_digest', 'eval_complete'))
);

CREATE UNIQUE INDEX program_notification_log_daily_uidx
  ON program_notification_log(user_id, program_id, kind, local_date)
  WHERE attack_id IS NULL;

CREATE UNIQUE INDEX program_notification_log_attack_uidx
  ON program_notification_log(user_id, kind, attack_id)
  WHERE attack_id IS NOT NULL;
