import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;

const scenarios: Scenario[] = [
  {
    name: 'outcomes, monthly and settings',
    sql: [
      `DELETE FROM user_outcome_settings WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `DELETE FROM medication_intakes WHERE user_id = ${U}`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
        SELECT ${U}, d::date, 'UTC', (ARRAY['migraine_day','headache_day','headache_free'])[1 + (extract(day FROM d)::int % 3)]
        FROM generate_series(CURRENT_DATE - 120, CURRENT_DATE - 1, interval '1 day') d
        WHERE extract(day FROM d)::int % 5 <> 0`,
      `INSERT INTO medication_intakes (user_id, taken_at, unit_is_custom, medication_name) VALUES
        (${U}, now() - interval '3 day', false, ' Ibuprofen '), (${U}, now() - interval '3 day', false, 'Aspirin'),
        (${U}, now() - interval '40 day', false, 'Naproxen'), (${U}, now() - interval '10 day', false, '  '),
        (${U}, now() - interval '70 day', false, NULL)`,
    ],
    steps: [
      { name: 'settings-default', path: '/api/outcomes/settings' },
      { name: 'outcomes-default', path: '/api/outcomes' },
      { name: 'outcomes-window', path: '/api/outcomes?windowDays=7' },
      { name: 'outcomes-range', path: '/api/outcomes?from=2020-01-01&to=2020-01-03' },
      { name: 'outcomes-only-from', path: '/api/outcomes?from=2020-01-01&windowDays=3' },
      { name: 'outcomes-to', path: '/api/outcomes?to=2030-01-10&windowDays=3' },
      { name: 'outcomes-reversed', path: '/api/outcomes?from=2030-01-10&to=2030-01-01' },
      { name: 'outcomes-rollover', path: '/api/outcomes?from=2026-02-30&to=2026-03-02' },
      { name: 'outcomes-to-rollover', path: '/api/outcomes?to=2026-02-30' },
      { name: 'outcomes-month13', path: '/api/outcomes?from=2026-13-01&to=2026-13-02' },
      { name: 'outcomes-invalid', path: '/api/outcomes?from=1.1.2026&windowDays=400' },
      { name: 'monthly', path: '/api/outcomes/monthly' },
      { name: 'monthly-3', path: '/api/outcomes/monthly?months=3' },
      { name: 'monthly-invalid', path: '/api/outcomes/monthly?months=37' },
      { name: 'settings-put', method: 'PUT', path: '/api/outcomes/settings', body: { baselineFrom: '2026-01-01', preferredWindowDays: 14 } },
      { name: 'outcomes-with-baseline', path: '/api/outcomes' },
      { name: 'settings-put-end', method: 'PUT', path: '/api/outcomes/settings', body: { baselineFrom: null, baselineTo: '2030-02-01' } },
      { name: 'outcomes-with-end', path: '/api/outcomes?windowDays=28' },
      { name: 'settings-put-keep', method: 'PUT', path: '/api/outcomes/settings', body: {} },
      { name: 'settings-put-rollover', method: 'PUT', path: '/api/outcomes/settings', body: { baselineFrom: '2026-02-30' } },
      { name: 'settings-put-invalid', method: 'PUT', path: '/api/outcomes/settings', body: { baselineFrom: '1.1', preferredWindowDays: 0 } },
      { name: 'settings-put-bad-json', method: 'PUT', path: '/api/outcomes/settings', rawBody: '[' },
      { name: 'settings-after', path: '/api/outcomes/settings' },
    ],
  },
  {
    name: 'outcomes responder with full coverage',
    sql: [
      `DELETE FROM user_outcome_settings WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
        SELECT ${U}, d::date, 'UTC', CASE WHEN d < CURRENT_DATE - 40 AND extract(day FROM d)::int % 2 = 0 THEN 'migraine_day' ELSE 'headache_free' END
        FROM generate_series(CURRENT_DATE - 80, CURRENT_DATE, interval '1 day') d`,
      `INSERT INTO user_outcome_settings (user_id, baseline_start, preferred_window_days) VALUES (${U}, (CURRENT_DATE - 70)::timestamp, 28)`,
    ],
    steps: [
      { name: 'outcomes', path: '/api/outcomes' },
      { name: 'no-baseline-migraines', path: '/api/outcomes?windowDays=5' },
    ],
  },
];

export default scenarios;
