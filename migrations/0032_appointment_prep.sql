CREATE TABLE appointment_prep (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  appointment_date date NOT NULL,
  visit_label text,
  clinician_name text,
  visit_reason text,
  top_concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  doctor_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  personal_notes text,
  compare_window_days integer NOT NULL DEFAULT 90,
  generated_snapshot jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX appointment_prep_user_date_idx
  ON appointment_prep (user_id, appointment_date);

ALTER TABLE doctor_share_link
  ADD COLUMN appointment_prep_id uuid REFERENCES appointment_prep(id) ON DELETE SET NULL;
