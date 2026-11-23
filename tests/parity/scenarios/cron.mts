import type { Scenario, Step } from '../run.mts';

// Needs CRON_SECRET, ENABLE_STALE_EPISODE_REMINDER, ENABLE_F39_INSIGHTS and
// the push setup of push.mts on both servers (see docs/migration/STATUS.md).
const U = `'e2e_user_test_001'`;
const SECRET = { 'x-cron-secret': 'parity-cron-secret-0123456789' };
const ZONE = `(SELECT z FROM unnest(ARRAY['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) z
  WHERE extract(hour FROM now() AT TIME ZONE z) BETWEEN 10 AND 18 LIMIT 1)`;
const local = (shift: string) => `to_char((now() AT TIME ZONE ${ZONE}) + interval '${shift}', 'HH24:MI')`;
const VOLATILE = ['duration'];
const run = (name: string, job: string, extra: Partial<Step> = {}): Step =>
  ({ name, method: 'POST', path: `/api/cron/${job}`, headers: SECRET, volatile: VOLATILE, ...extra });

const setup = [
  'DELETE FROM cron_run_lock',
  `DELETE FROM push_subscription WHERE user_id = ${U}`,
  `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES (${U}, 'https://localhost:3099/ok-cron', 'BGGMAS8DUjSPoek9Mg4qH9GHwBOZF6CNMS_dpYCBelt1g8zcU1vuMnFW5YDjGikW1s_B_5mejO5AVHYAqCi1Ttw', 'cdy0PYUyd7hjhQZ3dkAj3w')
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id`,
  `DELETE FROM risk_alert_run WHERE user_id = ${U}`,
  `UPDATE user_weather_settings SET alerts_enabled = true, timezone = ${ZONE}, pressure_drop_threshold_hpa = 3, lat = 10.5, lon = 20.5 WHERE user_id = ${U}`,
  `DELETE FROM pressure_forecast_cache WHERE lat = 10.5 AND lon = 20.5`,
  `INSERT INTO pressure_forecast_cache (lat, lon, points, fetched_at) VALUES (10.5, 20.5, jsonb_build_array(
    jsonb_build_object('dt', extract(epoch FROM now())::bigint, 'pressureHpa', 1020),
    jsonb_build_object('dt', extract(epoch FROM now() + interval '1 day')::bigint, 'pressureHpa', 1012.44)), now())`,
  `DELETE FROM solar_activity_snapshot WHERE source = 'gfz'`,
  `INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source, raw) VALUES (now(), 3, 'gfz', jsonb_build_object('raw', jsonb_build_object(
    'datetime', jsonb_build_array(to_char(now() - interval '3 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char((now() AT TIME ZONE 'UTC') + interval '6 hour', 'YYYY-MM-DD"T"HH24:00:00"Z"'),
      to_char((now() AT TIME ZONE 'UTC') + interval '9 hour', 'YYYY-MM-DD"T"HH24:00:00"Z"')),
    'Kp', jsonb_build_array(8, 6.333, '6.333'))))`,
  `INSERT INTO episode (id, user_id, start_time, intensity, pain_location, pain_type) VALUES
    (970001, ${U}, now() - interval '50 hour', 3, 'LEFT', 'PRESSURE'), (970002, ${U}, now() - interval '31 minute', 3, 'LEFT', 'PRESSURE')`,
  `UPDATE episode SET is_ongoing = true WHERE id = 970002`,
  `DELETE FROM preventive_reminder_log WHERE user_id = ${U}`,
  `INSERT INTO user_outcome_settings (user_id, timezone) VALUES (${U}, ${ZONE}) ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
  `UPDATE preventive_plan SET reminders_enabled = true, reminder_times = jsonb_build_array(${local('-10 minutes')}, ${local('-200 minutes')}, ${local('+60 minutes')}) WHERE user_id = ${U}`,
  `DELETE FROM program_notification_log WHERE user_id = ${U}`,
  `DELETE FROM program_enrollment WHERE user_id = ${U}`,
  `INSERT INTO program_settings (user_id, notifications_config) VALUES (${U}, '{"windDown": true, "morningCheckIn": 1, "onsetNudge": true, "weeklyDigest": true}')
    ON CONFLICT (user_id) DO UPDATE SET notifications_config = EXCLUDED.notifications_config`,
  `INSERT INTO program_enrollment (user_id, program_id, status, target_payload, start_date, baseline_window_start, baseline_window_end,
    evaluation_window_start, evaluation_window_end, ramp_days, timezone) VALUES
    (${U}, 'sleep-regularity', 'active', jsonb_build_object('bedTime', ${local('+32 minutes')}, 'wakeTime', ${local('-28 minutes')}),
      current_date - 30, current_date - 60, current_date - 31, current_date - 20, current_date + 5, 7, ${ZONE}),
    (${U}, 'acute-med-timing', 'active', '{}', current_date - 30, current_date - 60, current_date - 31, current_date - 20, current_date - 1, 7, ${ZONE})`,
];

const scenarios: Scenario[] = [
  {
    name: 'cron auth and health checks',
    sql: ['DELETE FROM cron_run_lock'],
    steps: [
      { name: 'no-secret', method: 'POST', path: '/api/cron/daily-risk' },
      { name: 'wrong-secret', method: 'POST', path: '/api/cron/daily-risk', headers: { 'x-cron-secret': 'parity-cron-secret-0123456788' } },
      { name: 'bearer-wrong', path: '/api/cron/insights', headers: { authorization: 'Bearer nope' } },
      { name: 'health-daily', path: '/api/cron/daily-risk', headers: SECRET },
      { name: 'health-insights', path: '/api/cron/insights', headers: { authorization: 'Bearer parity-cron-secret-0123456789' } },
      { name: 'health-solar', path: '/api/cron/solar-activity', headers: SECRET },
      { name: 'locked', method: 'POST', path: '/api/cron/insights', headers: SECRET, volatile: ['duration'] },
    ],
  },
  {
    name: 'cron jobs',
    sql: setup,
    steps: [
      run('stale', 'stale-episode-reminder'),
      run('stale-again', 'stale-episode-reminder'),
      run('medication', 'medication-reminders'),
      run('medication-again', 'medication-reminders', { method: 'GET' }),
      run('programs', 'programs-reminders'),
      run('programs-again', 'programs-reminders'),
      run('daily-risk', 'daily-risk'),
      run('daily-risk-again', 'daily-risk', { path: '/api/cron/daily-risk?run=1', method: 'GET' }),
      run('insights', 'insights'),
    ],
  },
];

export default scenarios;
