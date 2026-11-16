-- Programs module foundations + diary columns

CREATE TABLE program_settings (
  user_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  notifications_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE program_enrollment (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  program_id text NOT NULL,
  status text NOT NULL,
  target_payload jsonb NOT NULL,
  start_date date NOT NULL,
  end_date date,
  baseline_window_start date NOT NULL,
  baseline_window_end date NOT NULL,
  evaluation_window_start date NOT NULL,
  evaluation_window_end date NOT NULL,
  ramp_days integer NOT NULL DEFAULT 14,
  timezone text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX program_enrollment_user_idx ON program_enrollment(user_id);
CREATE UNIQUE INDEX program_enrollment_active_uidx
  ON program_enrollment(user_id, program_id)
  WHERE status = 'active';

CREATE TABLE program_adherence_event (
  id serial PRIMARY KEY,
  enrollment_id integer NOT NULL REFERENCES program_enrollment(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  program_id text NOT NULL,
  local_date date,
  attack_id integer REFERENCES episode(id) ON DELETE CASCADE,
  signal text NOT NULL,
  source text NOT NULL,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (signal IN ('hit', 'miss', 'na')),
  CHECK (source IN ('diary', 'episode', 'computed', 'notification')),
  CHECK ((local_date IS NOT NULL) OR (attack_id IS NOT NULL))
);

CREATE UNIQUE INDEX program_adherence_event_daily_uidx
  ON program_adherence_event(enrollment_id, local_date)
  WHERE attack_id IS NULL;

CREATE UNIQUE INDEX program_adherence_event_attack_uidx
  ON program_adherence_event(enrollment_id, attack_id)
  WHERE attack_id IS NOT NULL;

CREATE TABLE program_recommendation_dismissal (
  user_id text NOT NULL,
  program_id text NOT NULL,
  dismissed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, program_id)
);

ALTER TABLE daily_diary_entry
  ADD COLUMN bed_time_local time,
  ADD COLUMN wake_time_local time;
