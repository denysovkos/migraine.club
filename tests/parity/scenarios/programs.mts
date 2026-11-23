import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const SLEEPF = 'cccccccc-0000-4000-8000-000000000001';

const reset = [
  `DELETE FROM program_adherence_event WHERE user_id = ${U}`,
  `DELETE FROM program_enrollment WHERE user_id = ${U}`,
  `DELETE FROM program_settings WHERE user_id = ${U}`,
  `DELETE FROM program_recommendation_dismissal WHERE user_id = ${U}`,
];

const scenarios: Scenario[] = [
  {
    name: 'programs module',
    sql: [
      ...reset,
      `DELETE FROM intake_response WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `DELETE FROM factor_event WHERE user_id = ${U}`,
      `DELETE FROM acute_doses WHERE user_id = ${U}`,
      `DELETE FROM episode WHERE user_id = ${U}`,
      `INSERT INTO factor (id, user_id, key, type, display_name) VALUES ('${SLEEPF}', ${U}, 'sleep_issue', 'trigger', 'Poor sleep') ON CONFLICT DO NOTHING`,
      `INSERT INTO factor_event (user_id, factor_id, occurred_at, source)
        SELECT ${U}, '${SLEEPF}'::uuid, now() - (n * interval '1 day'), 'user' FROM generate_series(0, 15) n
        UNION ALL SELECT ${U}, '${SLEEPF}'::uuid, now() - interval '1 hour', 'user'`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
        SELECT ${U}, d::date, 'UTC', CASE WHEN extract(day FROM d)::int % 3 = 0 THEN 'migraine_day' ELSE 'headache_free' END
        FROM generate_series(CURRENT_DATE - 60, CURRENT_DATE, interval '1 day') d`,
      `INSERT INTO episode (id, user_id, attack_type, start_time, onset_at, intensity, pain_location, pain_type) VALUES
        (970001, ${U}, 'migraine', now() - interval '3 day', now() - interval '3 day' - interval '40 minute', 3, 'LEFT', 'PRESSURE'),
        (970002, ${U}, 'migraine', now() - interval '5 day', NULL, 3, 'LEFT', 'PRESSURE')`,
      `INSERT INTO user_medications (id, user_id, custom_name, medication_class) VALUES ('cccccccc-0000-4000-8000-000000000002', ${U}, 'Parity triptan', 'triptan') ON CONFLICT DO NOTHING`,
      `INSERT INTO acute_doses (user_id, medication_id, attack_id, taken_at)
        SELECT ${U}, um.id, a.attack, a.at FROM (VALUES (970001, now() - interval '3 day' + interval '50 minute'), (970001, now() - interval '3 day' + interval '2 hour'),
          (970002, now() - interval '5 day' + interval '95 minute')) AS a(attack, at)
        CROSS JOIN LATERAL (SELECT 'cccccccc-0000-4000-8000-000000000002'::uuid AS id) um`,
      `INSERT INTO intake_response (user_id, status, answers) VALUES (${U}, 'completed',
        '{"habits": {"sleepTrouble": "often", "typicalBed": null, "typicalWake": null, "medTiming": "gt120"}}')`,
    ],
    steps: [
      { name: 'settings-default', path: '/api/programs/settings' },
      { name: 'list-disabled', path: '/api/programs' },
      { name: 'detail-disabled', path: '/api/programs/sleep-regularity' },
      { name: 'enable', method: 'PATCH', path: '/api/programs/settings', body: { enabled: true, notificationsConfig: { weeklyDigest: true, windDown: false } }, volatile: ['updatedAt'] },
      { name: 'merge', method: 'PATCH', path: '/api/programs/settings', body: { notificationsConfig: { onsetNudge: true, morningCheckIn: true, junk: 1 } }, volatile: ['updatedAt'] },
      { name: 'settings-invalid', method: 'PATCH', path: '/api/programs/settings', body: { enabled: 'yes' } },
      { name: 'settings-bad-json', method: 'PATCH', path: '/api/programs/settings', rawBody: '{' },
      { name: 'list', path: '/api/programs' },
      { name: 'detail', path: '/api/programs/sleep-regularity' },
      { name: 'detail-fr', path: '/api/programs/acute-med-timing?locale=fr' },
      { name: 'detail-header', path: '/api/programs/sleep-regularity', headers: { 'accept-language': 'uk-UA,uk;q=0.9' } },
      { name: 'detail-header-de', path: '/api/programs/sleep-regularity', headers: { 'accept-language': 'de' } },
      { name: 'detail-missing', path: '/api/programs/nope' },
      { name: 'recommendations', path: '/api/programs/recommendations' },
      { name: 'dismiss', method: 'POST', path: '/api/programs/recommendations/sleep-regularity/dismiss' },
      { name: 'recommendations-after-dismiss', path: '/api/programs/recommendations' },
      { name: 'enroll-sleep', method: 'POST', path: '/api/programs/sleep-regularity/enroll', body: { targetPayload: { wakeTime: '07:00', bedTime: '23:00', toleranceMinutes: 30, extra: true } } },
      { name: 'enroll-again', method: 'POST', path: '/api/programs/sleep-regularity/enroll', body: { targetPayload: { bedTime: '23:00', wakeTime: '07:00', toleranceMinutes: 30 } } },
      { name: 'enroll-acute', method: 'POST', path: '/api/programs/acute-med-timing/enroll', body: { targetPayload: { acuteWindowMinutes: 60 } } },
      { name: 'enroll-unknown', method: 'POST', path: '/api/programs/nope/enroll', body: { targetPayload: { acuteWindowMinutes: 60 } } },
      { name: 'enroll-invalid', method: 'POST', path: '/api/programs/sleep-regularity/enroll', body: { targetPayload: { bedTime: '25:00' } } },
      { name: 'enroll-bad-json', method: 'POST', path: '/api/programs/sleep-regularity/enroll', rawBody: '{"x"' },
      { name: 'enrollments', path: '/api/programs/enrollments' },
      { name: 'detail-enrolled', path: '/api/programs/acute-med-timing' },
      { name: 'progress-sleep', path: '/api/programs/sleep-regularity/progress' },
      { name: 'progress-acute', path: '/api/programs/acute-med-timing/progress' },
      { name: 'progress-none', path: '/api/programs/other/progress' },
      { name: 'sleep-log', method: 'POST', path: '/api/programs/sleep-regularity/log', body: { localDate: '2099-01-01', bedTimeLocal: '23:10', wakeTimeLocal: '07:05' } },
      { name: 'sleep-log-miss', method: 'POST', path: '/api/programs/sleep-regularity/log', body: { localDate: '2099-01-01', bedTimeLocal: '01:30', wakeTimeLocal: null } },
      { name: 'sleep-log-invalid', method: 'POST', path: '/api/programs/sleep-regularity/log', body: { localDate: 'x', bedTimeLocal: '1:00' } },
      { name: 'sleep-log-bad-date', method: 'POST', path: '/api/programs/sleep-regularity/log', body: { localDate: '2099-02-30', bedTimeLocal: null, wakeTimeLocal: null } },
      { name: 'today-status', path: '/api/programs/sleep-regularity/today-status' },
      { name: 'attack', path: '/api/programs/acute-med-timing/attack/970001' },
      { name: 'attack-no-onset', path: '/api/programs/acute-med-timing/attack/970002' },
      { name: 'attack-hex', path: '/api/programs/acute-med-timing/attack/0x10' },
      { name: 'attack-nan', path: '/api/programs/acute-med-timing/attack/abc' },
      { name: 'attack-fraction', path: '/api/programs/acute-med-timing/attack/1.5' },
      { name: 'attack-huge', path: '/api/programs/acute-med-timing/attack/99999999999' },
      { name: 'pause-missing', method: 'POST', path: '/api/programs/x/pause', body: { enrollmentId: 1 } },
      { name: 'pause-invalid', method: 'POST', path: '/api/programs/x/pause', body: { enrollmentId: 1.5 } },
      { name: 'pause-bad-json', method: 'POST', path: '/api/programs/x/pause', rawBody: 'x' },
      { name: 'end-huge', method: 'POST', path: '/api/programs/x/end', body: { enrollmentId: 99999999999 }, volatile: ['error'] },
    ],
  },
  {
    name: 'program enrollment status',
    sql: [
      ...reset,
      `INSERT INTO program_settings (user_id, enabled, notifications_config) VALUES (${U}, true, '{}')`,
      `INSERT INTO program_enrollment (id, user_id, program_id, status, target_payload, start_date, baseline_window_start, baseline_window_end,
        evaluation_window_start, evaluation_window_end, ramp_days, timezone)
        VALUES (980001, ${U}, 'sleep-regularity', 'active', '{"bedTime":"23:00","wakeTime":"07:00","toleranceMinutes":30}', CURRENT_DATE - 60,
        CURRENT_DATE - 88, CURRENT_DATE - 61, CURRENT_DATE - 46, CURRENT_DATE - 19, 14, 'UTC')`,
      `INSERT INTO program_adherence_event (enrollment_id, user_id, program_id, local_date, signal, source) VALUES
        (980001, ${U}, 'sleep-regularity', CURRENT_DATE - 2, 'hit', 'diary'), (980001, ${U}, 'sleep-regularity', CURRENT_DATE - 1, 'miss', 'diary'),
        (980001, ${U}, 'sleep-regularity', CURRENT_DATE, 'na', 'diary')`,
    ],
    steps: [
      { name: 'progress-complete', path: '/api/programs/sleep-regularity/progress' },
      { name: 'today-status', path: '/api/programs/sleep-regularity/today-status' },
      { name: 'pause', method: 'POST', path: '/api/programs/whatever/pause', body: { enrollmentId: 980001 } },
      { name: 'resume', method: 'POST', path: '/api/programs/whatever/resume', body: { enrollmentId: 980001 } },
      { name: 'end', method: 'POST', path: '/api/programs/whatever/end', body: { enrollmentId: 980001 } },
      { name: 'today-status-ended', path: '/api/programs/sleep-regularity/today-status' },
    ],
  },
];

export default scenarios;
