import type { Scenario } from '../run.mts';

// The footer and cover print the current minute.
const GENERATED = /Generated on \d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

const U = `'e2e_user_test_001'`;
const MED = 'dddddddd-0000-4000-8000-000000000001';
const MED2 = 'dddddddd-0000-4000-8000-000000000002';
const PREP = 'dddddddd-0000-4000-8000-0000000000a1';
const cfg = (c: unknown) => `/api/reports/clinician/preview?config=${encodeURIComponent(JSON.stringify(c))}`;

const setup = [
  `DELETE FROM appointment_prep WHERE user_id = ${U}`,
  `DELETE FROM acute_doses WHERE user_id = ${U}`,
  `DELETE FROM medication_intakes WHERE user_id = ${U}`,
  `DELETE FROM episode WHERE user_id = ${U}`,
  `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
  `DELETE FROM cycle_bleeding_day WHERE user_id = ${U}`,
  `DELETE FROM cycle_settings WHERE user_id = ${U}`,
  `DELETE FROM questionnaire_responses WHERE user_id = ${U}`,
  `INSERT INTO user_medications (id, user_id, custom_name, medication_class) VALUES
    ('${MED}', ${U}, 'Parity <Suma>', 'triptan'), ('${MED2}', ${U}, 'Ibuprofen', 'non_opioid_simple_analgesic') ON CONFLICT DO NOTHING`,
  `INSERT INTO episode (id, user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type, symptoms, medications)
    SELECT 990000 + n, ${U}, CASE WHEN n % 3 = 0 THEN 'headache' ELSE 'migraine' END,
      now() - (n * interval '2 day'), now() - (n * interval '2 day') + (n * interval '37 minute'), 1 + n % 5, 'LEFT', 'PRESSURE',
      '["nausea", "  light   sensitivity ", "{x}"]'::jsonb, '[{"name": "Suma"}, {"name": "Suma"}, {"name": ""}]'::jsonb
    FROM generate_series(1, 30) n`,
  `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, impact)
    SELECT ${U}, d::date, 'UTC', CASE WHEN extract(day FROM d)::int % 3 = 0 THEN 'migraine_day' WHEN extract(day FROM d)::int % 3 = 1 THEN 'headache_day' ELSE 'headache_free' END,
      CASE WHEN extract(day FROM d)::int % 2 = 0 THEN 2 ELSE NULL END
    FROM generate_series(CURRENT_DATE - 100, CURRENT_DATE - 1, interval '1 day') d`,
  `INSERT INTO acute_doses (user_id, medication_id, attack_id, taken_at)
    SELECT ${U}, CASE WHEN n % 2 = 0 THEN '${MED}'::uuid ELSE '${MED2}'::uuid END, 990000 + n, now() - (n * interval '1 day') - interval '3 hour'
    FROM generate_series(1, 25) n
    UNION ALL SELECT ${U}, '${MED}'::uuid, 990002, now() - interval '2 day' + interval '2 hour'`,
  `INSERT INTO medication_intakes (user_id, episode_id, taken_at, unit_is_custom, medication_name)
    SELECT ${U}, 990000 + n, now() - (n * interval '2 day') + interval '10 minute', false, CASE WHEN n % 2 = 0 THEN 'Rizatriptan' ELSE '  ibuprofen  ' END
    FROM generate_series(1, 20) n`,
  `INSERT INTO questionnaire_responses (user_id, type, taken_at, answers, score_total) VALUES
    (${U}, 'HIT6', now() - interval '3 day', '{}', 58), (${U}, 'HIT6', now() - interval '30 day', '{}', 66), (${U}, 'MIDAS', now() - interval '5 day', '{}', 21)`,
  `INSERT INTO appointment_prep (id, user_id, appointment_date, visit_label, clinician_name, visit_reason, top_concerns, doctor_questions,
    personal_notes, compare_window_days, generated_snapshot) VALUES
    ('${PREP}', ${U}, '2030-01-05', 'Neuro <check>', NULL, 'Worse   lately', '["Sleep", "", "Aura & nausea"]', '["Dose?"]', NULL, 90,
     '{"compareWindowDays": 90, "coverage": {"totalDays": 90, "recordedDays": 80, "missingDays": 10}, "attackStats": {"totalAttacks": 12, "avgIntensity": 5},
       "currentSnapshot": {"headacheBurden": {"migraineDays": 7, "headacheDays": 11}, "acuteMedicationDays": 9, "preventiveNames": ["Topiramate"],
       "questionnaireScores": {"hit6": 60, "midas": null}}, "whatChangedKeys": ["coverage_summary", "attack_summary", "mystery_key"],
       "questionPromptKeys": ["treatment_adjustment", "acute_medication_safety"]}')`,
];

const scenarios: Scenario[] = [
  {
    name: 'clinician preview, MOH, acute report',
    sql: setup,
    steps: [
      { name: 'preview-default', path: '/api/reports/clinician/preview', text: true, masks: [GENERATED] },
      { name: 'preview-full', path: cfg({ template: 'full' }), text: true, masks: [GENERATED] },
      { name: 'preview-custom', path: cfg({ template: 'custom', rangePreset: 'last30', sections: { cover: false, diary: true, medications: true } }), text: true, masks: [GENERATED] },
      { name: 'preview-range', path: cfg({ template: 'full', rangePreset: 'custom', from: '2020-01-01', to: '2020-01-20' }), text: true, masks: [GENERATED] },
      { name: 'preview-prep', path: cfg({ appointmentPrepId: PREP }), text: true, masks: [GENERATED] },
      { name: 'preview-bad-json', path: '/api/reports/clinician/preview?config=%7Bbad' },
      { name: 'preview-invalid', path: cfg({ template: 'nope', rangePreset: 'custom' }) },
      { name: 'preview-reversed', path: cfg({ rangePreset: 'custom', from: '2020-02-01', to: '2020-01-01' }) },
      { name: 'preview-rollover', path: cfg({ rangePreset: 'custom', from: '2020-02-30', to: '2020-03-01' }) },
      { name: 'moh', path: '/api/moh-status', volatile: ['asOf'] },
      { name: 'enable-cycle-export', method: 'PUT', path: '/api/cycle/settings', body: { enabled: true, includeInExports: true, hormoneProfile: 'hrt' }, volatile: ['updatedAt'] },
      { name: 'bleed-today', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-01-31', bleeding: true } },
      { name: 'bleed-before', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-01-04', bleeding: true } },
      { name: 'preview-cycle', path: cfg({ template: 'full', rangePreset: 'custom', from: '2026-01-01', to: '2026-01-31' }), text: true, masks: [GENERATED] },
      { name: 'moh-7', path: '/api/moh-status?windowDays=7', volatile: ['asOf'] },
      { name: 'moh-invalid', path: '/api/moh-status?windowDays=61' },
      { name: 'acute-report', path: '/api/acute-meds-report' },
      { name: 'acute-report-month', path: '/api/acute-meds-report?mode=calendarMonth' },
      { name: 'acute-report-invalid', path: '/api/acute-meds-report?mode=weekly' },
    ],
  },
  {
    name: 'appointment preps',
    sql: setup,
    steps: [
      { name: 'list', path: '/api/appointment-preps', volatile: ['createdAt', 'updatedAt'] },
      { name: 'get', path: `/api/appointment-preps/${PREP}`, volatile: ['createdAt', 'updatedAt'] },
      { name: 'get-missing', path: '/api/appointment-preps/dddddddd-0000-4000-8000-0000000000ff' },
      { name: 'get-bad-id', path: '/api/appointment-preps/abc' },
      { name: 'create', method: 'POST', path: '/api/appointment-preps', body: { appointmentDate: '2030-02-30', visitLabel: '  ', clinicianName: ' Dr. X ', topConcerns: [' a '], compareWindowDays: '30' }, volatile: ['id'] },
      { name: 'create-invalid', method: 'POST', path: '/api/appointment-preps', body: { appointmentDate: 'soon', compareWindowDays: 0, topConcerns: [1] } },
      { name: 'create-month13', method: 'POST', path: '/api/appointment-preps', body: { appointmentDate: '2030-13-01' } },
      { name: 'create-bad-json', method: 'POST', path: '/api/appointment-preps', rawBody: '{' },
      { name: 'list-after', path: '/api/appointment-preps', volatile: ['id', 'createdAt', 'updatedAt'] },
      { name: 'patch', method: 'PATCH', path: `/api/appointment-preps/${PREP}`, body: { visitLabel: null, personalNotes: ' notes ', topConcerns: ['x'], appointmentDate: '2030-03-01' }, volatile: ['createdAt', 'updatedAt'] },
      { name: 'patch-missing', method: 'PATCH', path: '/api/appointment-preps/dddddddd-0000-4000-8000-0000000000ff', body: {} },
      { name: 'patch-bad-id', method: 'PATCH', path: '/api/appointment-preps/abc', body: {} },
      { name: 'patch-invalid', method: 'PATCH', path: `/api/appointment-preps/${PREP}`, body: { visitReason: 'x'.repeat(501) } },
      { name: 'delete-bad-id', method: 'DELETE', path: '/api/appointment-preps/abc' },
      { name: 'delete', method: 'DELETE', path: `/api/appointment-preps/${PREP}` },
      { name: 'delete-again', method: 'DELETE', path: `/api/appointment-preps/${PREP}` },
    ],
  },
];

export default scenarios;
