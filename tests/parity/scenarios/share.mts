import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const PREP = 'dddddddd-0000-4000-8000-0000000000b1';
const T = {
  ok: 'parity_share_token_ok_000000000001',
  range: 'parity_share_token_range_00000001',
  revoked: 'parity_share_token_revoked_000001',
  expired: 'parity_share_token_expired_000001',
  bad: 'parity_share_token_badtriggers_01',
};

const setup = [
  `DELETE FROM doctor_share_link WHERE user_id = ${U}`,
  `DELETE FROM appointment_prep WHERE user_id = ${U}`,
  `DELETE FROM medication_intakes WHERE user_id = ${U}`,
  `DELETE FROM episode WHERE user_id = ${U}`,
  `DELETE FROM questionnaire_responses WHERE user_id = ${U}`,
  `INSERT INTO episode (id, user_id, attack_type, start_time, end_time, is_ongoing, intensity, pain_location, pain_type, symptoms, triggers, weather_context, notes)
    SELECT 980000 + n, ${U}, CASE WHEN n % 3 = 0 THEN 'headache' ELSE 'migraine' END,
      now() - (n * interval '3 day'), CASE WHEN n % 4 = 0 THEN NULL ELSE now() - (n * interval '3 day') + (n * interval '41 minute') END,
      n % 5 = 0, 1 + n % 5, 'LEFT', 'PRESSURE',
      CASE WHEN n % 2 = 0 THEN '["nausea", "aura", "nausea"]'::jsonb ELSE '["aura"]'::jsonb END,
      CASE WHEN n % 3 = 0 THEN '["10", "stress", "2", "stress"]'::jsonb WHEN n % 3 = 1 THEN 'null'::jsonb ELSE '[]'::jsonb END,
      CASE n % 4 WHEN 0 THEN '{"wpiScore": 61.5, "wpiLevel": "high", "kpIndex": null, "deltaPressure": -7.25, "humidity": 80, "extra": 1}'::jsonb
        WHEN 1 THEN '{"wpiScore": 20, "wpiLevel": "low"}'::jsonb WHEN 2 THEN '"text"'::jsonb ELSE NULL END,
      CASE WHEN n = 1 THEN E'line\\nbreak' ELSE NULL END
    FROM generate_series(1, 40) n`,
  `INSERT INTO medication_intakes (user_id, episode_id, taken_at, dose, unit, unit_is_custom, medication_name)
    SELECT ${U}, 980000 + n, now() - (n * interval '3 day') + interval '15 minute', CASE WHEN n % 2 = 0 THEN '10' END, CASE WHEN n % 2 = 0 THEN 'mg' END,
      false, CASE n % 3 WHEN 0 THEN 'Rizatriptan' WHEN 1 THEN '  ' ELSE '  Ibuprofen ' END
    FROM generate_series(1, 25) n`,
  `INSERT INTO medication_intakes (user_id, taken_at, unit_is_custom, medication_name) VALUES (${U}, now() - interval '1 day', false, 'Naproxen')`,
  `INSERT INTO questionnaire_responses (user_id, type, taken_at, answers, score_total, score_details) VALUES
    (${U}, 'HIT6', now() - interval '3 day', '{}', 58, '{"band": "severe"}'), (${U}, 'MIDAS', now() - interval '5 day', '{}', NULL, NULL),
    (${U}, 'MSQ21', now() - interval '6 day', '{}', 70, '{"rp": 1}')`,
  `INSERT INTO appointment_prep (id, user_id, appointment_date, visit_label, top_concerns, doctor_questions, compare_window_days, generated_snapshot)
    VALUES ('${PREP}', ${U}, '2030-01-05', 'Neuro', '["Sleep"]', 'null', 90, '{"compareWindowDays": 90}')`,
  `INSERT INTO doctor_share_link (user_id, token, label, recipient_name, patient_display_name, expires_at, appointment_prep_id) VALUES
    (${U}, '${T.ok}', 'Visit', 'Dr. Who', 'Pat', now() + interval '2 day', '${PREP}')`,
  `INSERT INTO doctor_share_link (user_id, token, patient_display_name, expires_at, date_range_start, date_range_end) VALUES
    (${U}, '${T.range}', '', now() + interval '2 day', now() - interval '30 day', now() - interval '10 day')`,
  `INSERT INTO doctor_share_link (user_id, token, expires_at, is_revoked) VALUES (${U}, '${T.revoked}', now() + interval '2 day', true)`,
  `INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES (${U}, '${T.expired}', now() - interval '1 minute')`,
];

const scenarios: Scenario[] = [
  {
    name: 'share links owner API',
    sql: setup,
    steps: [
      { name: 'list', path: '/api/share' },
      { name: 'create', method: 'POST', path: '/api/share', body: { label: 'L', recipientName: 'Dr', patientDisplayName: 'Pat', expiresInDays: 14, dateRangeStart: '2026-01-01T00:00:00Z', dateRangeEnd: '2026-12-31T23:59:59.123456Z', appointmentPrepId: PREP }, volatile: ['token'] },
      { name: 'create-default', method: 'POST', path: '/api/share', body: {}, volatile: ['token'] },
      { name: 'create-invalid', method: 'POST', path: '/api/share', body: { expiresInDays: 0, label: 5, dateRangeStart: 'yesterday', appointmentPrepId: 'x', recipientName: 'x'.repeat(201) } },
      { name: 'create-null', method: 'POST', path: '/api/share', body: { label: null, expiresInDays: 2.5 } },
      { name: 'create-array', method: 'POST', path: '/api/share', body: [] },
      { name: 'create-bad-json', method: 'POST', path: '/api/share', rawBody: '{' },
      { name: 'create-minutes', method: 'POST', path: '/api/share', body: { dateRangeStart: '2026-02-29T10:00Z' } },
      { name: 'list-after', path: '/api/share', volatile: ['token'] },
      { name: 'revoke-empty', method: 'DELETE', path: '/api/share', rawBody: '' },
      { name: 'revoke-null', method: 'DELETE', path: '/api/share', rawBody: 'null' },
      { name: 'revoke-no-id', method: 'DELETE', path: '/api/share', body: {} },
      { name: 'revoke-zero', method: 'DELETE', path: '/api/share', body: { id: 0 } },
      { name: 'revoke-number', method: 'DELETE', path: '/api/share', body: { id: 5 } },
      { name: 'revoke-bad', method: 'DELETE', path: '/api/share', body: { id: 'abc' } },
      { name: 'revoke-missing', method: 'DELETE', path: '/api/share', body: { id: 'dddddddd-0000-4000-8000-0000000000ff' } },
      { name: 'revoke', method: 'DELETE', path: '/api/share', body: { id: '{{create.body.id}}' } },
      { name: 'revoke-again', method: 'DELETE', path: '/api/share', body: { id: '{{create.body.id}}' } },
      { name: 'view-created-revoked', path: '/api/share/{{create.body.token}}' },
      { name: 'view-default', path: '/api/share/{{create-default.body.token}}' },
      { name: 'list-final', path: '/api/share', volatile: ['token'] },
    ],
  },
  {
    name: 'public share view',
    sql: setup,
    steps: [
      { name: 'ok', path: `/api/share/${T.ok}` },
      { name: 'ok-again', path: `/api/share/${T.ok}` },
      { name: 'range', path: `/api/share/${T.range}` },
      { name: 'revoked', path: `/api/share/${T.revoked}` },
      { name: 'expired', path: `/api/share/${T.expired}` },
      { name: 'short', path: '/api/share/short' },
      { name: 'unknown', path: '/api/share/parity_share_token_unknown_0001' },
      { name: 'encoded', path: `/api/share/${encodeURIComponent('ünïcödé/tøken with spaces')}` },
      { name: 'list-counts', path: '/api/share' },
    ],
  },
  {
    name: 'public share view with non-array triggers',
    sql: [
      ...setup,
      `UPDATE episode SET triggers = '"oops"'::jsonb WHERE id = 980001`,
      `INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES (${U}, '${T.bad}', now() + interval '1 day')`,
    ],
    steps: [{ name: 'view', path: `/api/share/${T.bad}` }],
  },
];

export default scenarios;
