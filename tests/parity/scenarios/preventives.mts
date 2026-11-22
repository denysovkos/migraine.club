import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const DAILY = '11111111-1111-4111-8111-111111111111';
const SHOT = '22222222-2222-4222-8222-222222222222';
const WEEK = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';

const scenarios: Scenario[] = [
  {
    name: 'preventives',
    sql: [
      `DELETE FROM preventive_plan WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `DELETE FROM medication_intakes WHERE user_id = ${U}`,
      `INSERT INTO preventive_plan (id, user_id, name, kind, dose_text, schedule_type, schedule_payload, start_date, reminder_times, reminders_enabled, created_at) VALUES
        ('${DAILY}', ${U}, 'Topiramate', 'oral', '25 mg', 'daily', '{}', CURRENT_DATE - 45, '["08:00","20:30"]', true, now() - interval '3 day'),
        ('${SHOT}', ${U}, 'Erenumab', 'injection', NULL, 'every_n_weeks', '{"n": 4}', CURRENT_DATE - 29, '[]', false, now() - interval '2 day'),
        ('${WEEK}', ${U}, 'topiramate ', 'oral', NULL, 'custom_weekdays', '[1, 3, 5]', CURRENT_DATE - 10, '[]', false, now() - interval '1 day'),
        ('${OLD}', ${U}, 'Old', 'supplement', NULL, 'every_n_days', '{"n": 2}', CURRENT_DATE - 200, '[]', false, now() - interval '4 day')`,
      `INSERT INTO preventive_intake_event (user_id, plan_id, local_date, state) VALUES
        (${U}, '${DAILY}', CURRENT_DATE - 1, 'taken'), (${U}, '${DAILY}', CURRENT_DATE - 2, 'missed'), (${U}, '${DAILY}', CURRENT_DATE - 3, 'unsure'),
        (${U}, '${SHOT}', CURRENT_DATE - 2, 'taken'), (${U}, '${OLD}', CURRENT_DATE - 4, 'taken')`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type) VALUES
        (${U}, CURRENT_DATE - 60, 'UTC', 'migraine_day'), (${U}, CURRENT_DATE - 55, 'UTC', 'migraine_day'), (${U}, CURRENT_DATE - 50, 'UTC', 'headache_day'),
        (${U}, CURRENT_DATE - 20, 'UTC', 'migraine_day'), (${U}, CURRENT_DATE - 3, 'UTC', 'migraine_day'), (${U}, CURRENT_DATE - 2, 'UTC', 'headache_free')`,
      `INSERT INTO medication_intakes (user_id, taken_at, unit_is_custom, medication_name) VALUES
        (${U}, now() - interval '20 day', false, ' Ibuprofen '), (${U}, now() - interval '20 day', false, 'Aspirin'), (${U}, now() - interval '70 day', false, NULL)`,
    ],
    steps: [
      { name: 'list', path: '/api/preventives', volatile: ['createdAt', 'updatedAt'] },
      { name: 'detail', path: `/api/preventives/${DAILY}` },
      { name: 'detail-missing', path: `/api/preventives/${MISSING}` },
      { name: 'detail-bad-id', path: '/api/preventives/abc' },
      { name: 'summary-daily', path: `/api/preventives/${DAILY}/summary` },
      { name: 'summary-shot', path: `/api/preventives/${SHOT}/summary` },
      { name: 'summary-week', path: `/api/preventives/${WEEK}/summary` },
      { name: 'summary-old', path: `/api/preventives/${OLD}/summary` },
      { name: 'summary-missing', path: `/api/preventives/${MISSING}/summary` },
      { name: 'summary-bad-id', path: '/api/preventives/abc/summary' },
      { name: 'due', path: '/api/preventives/due' },
      { name: 'due-date', path: '/api/preventives/due?localDate=2030-01-07' },
      { name: 'due-iso', path: '/api/preventives/due?localDate=2030-01-07T23:30:00Z' },
      { name: 'due-week', path: '/api/preventives/due?localDate=2030-W02-3' },
      { name: 'due-empty', path: '/api/preventives/due?localDate=' },
      { name: 'due-bad', path: '/api/preventives/due?localDate=nope' },
      { name: 'create', method: 'POST', path: '/api/preventives', body: { name: ' New  Plan ', kind: 'device', doseText: ' x ', scheduleType: 'on_specific_dates', schedulePayload: ['2030-01-01', '2030-02-01'], startDate: '2030-01-01', reminderTimes: ['21:00', '07:30', '07:30'], remindersEnabled: true }, volatile: ['id'] },
      { name: 'create-minimal', method: 'POST', path: '/api/preventives', body: { name: 'Min', kind: 'other', scheduleType: 'daily', startDate: '2030-02-30' }, volatile: ['id'] },
      { name: 'create-invalid', method: 'POST', path: '/api/preventives', body: { name: '', kind: 'pill', scheduleType: 'hourly', startDate: 'x', schedulePayload: { n: 0 }, reminderTimes: ['08:15'], catalogMedicationId: 'nope' } },
      { name: 'create-payload-union', method: 'POST', path: '/api/preventives', body: { name: 'U', kind: 'oral', scheduleType: 'daily', startDate: '2030-01-01', schedulePayload: [1, 'a'] } },
      { name: 'create-bad-date', method: 'POST', path: '/api/preventives', body: { name: 'U', kind: 'oral', scheduleType: 'daily', startDate: '2030-13-01' } },
      { name: 'create-bad-json', method: 'POST', path: '/api/preventives', rawBody: '{"name": "x",}' },
      { name: 'create-empty', method: 'POST', path: '/api/preventives', rawBody: '' },
      { name: 'create-fk', method: 'POST', path: '/api/preventives', body: { name: 'F', kind: 'oral', scheduleType: 'every_n_days', schedulePayload: { n: 3, extra: 1 }, startDate: '2030-01-01', catalogMedicationId: MISSING, reminderTimes: ['08:00'] } },
      { name: 'list-after-create', path: '/api/preventives', volatile: ['id', 'createdAt', 'updatedAt'] },
      { name: 'patch', method: 'PATCH', path: `/api/preventives/${DAILY}`, body: { name: ' Topamax ', doseText: null, schedulePayload: null, scheduleType: 'weekdays', reminderTimes: ['09:00'] } },
      { name: 'patch-detail', path: `/api/preventives/${DAILY}` },
      { name: 'patch-missing', method: 'PATCH', path: `/api/preventives/${MISSING}`, body: { name: 'x' } },
      { name: 'patch-bad-id', method: 'PATCH', path: '/api/preventives/abc', body: {} },
      { name: 'patch-invalid', method: 'PATCH', path: `/api/preventives/${DAILY}`, body: { name: '', reminderTimes: Array.from({ length: 9 }).fill('08:00') } },
      { name: 'patch-bad-date', method: 'PATCH', path: `/api/preventives/${DAILY}`, body: { startDate: '2030-00-01' } },
      { name: 'intake', method: 'POST', path: '/api/preventives/intake', body: { planId: SHOT, localDate: '2030-01-01', state: 'taken', note: ' fine ' } },
      { name: 'intake-overflow', method: 'POST', path: '/api/preventives/intake', body: { planId: SHOT, localDate: '2030-02-31', state: 'missed' } },
      { name: 'intake-missing', method: 'POST', path: '/api/preventives/intake', body: { planId: MISSING, localDate: '2030-01-01', state: 'taken' } },
      { name: 'intake-invalid', method: 'POST', path: '/api/preventives/intake', body: { planId: 'x', localDate: '1.1.2030', state: 'maybe', note: 5 } },
      { name: 'checkin', method: 'POST', path: `/api/preventives/${SHOT}/weekly-checkin`, body: { weekStartLocalDate: '2030-01-06', sideEffects: 'mild', stillTaking: 'yes', note: ' ok ' } },
      { name: 'checkin-again', method: 'POST', path: `/api/preventives/${SHOT}/weekly-checkin`, body: { weekStartLocalDate: '2030-01-06', sideEffects: 'none', stillTaking: 'paused', planId: OLD } },
      { name: 'checkin-missing', method: 'POST', path: `/api/preventives/${MISSING}/weekly-checkin`, body: { weekStartLocalDate: '2030-01-06', sideEffects: 'mild', stillTaking: 'yes' } },
      { name: 'checkin-bad-id', method: 'POST', path: '/api/preventives/abc/weekly-checkin', body: { weekStartLocalDate: 'x' } },
      { name: 'checkin-array', method: 'POST', path: `/api/preventives/${SHOT}/weekly-checkin`, body: [1, 2] },
      { name: 'pause', method: 'POST', path: `/api/preventives/${WEEK}/pause` },
      { name: 'pause-again', method: 'POST', path: `/api/preventives/${WEEK}/pause` },
      { name: 'pause-missing', method: 'POST', path: `/api/preventives/${MISSING}/pause` },
      { name: 'resume', method: 'POST', path: `/api/preventives/${WEEK}/resume` },
      { name: 'stop', method: 'POST', path: `/api/preventives/${OLD}/stop`, body: { reason: 'not_helping', reasonNote: ' meh ' } },
      { name: 'stop-invalid', method: 'POST', path: `/api/preventives/${WEEK}/stop`, body: { reason: 'bored' } },
      { name: 'stop-bad-json', method: 'POST', path: `/api/preventives/${WEEK}/stop`, rawBody: '{' },
      { name: 'intake-stopped', method: 'POST', path: '/api/preventives/intake', body: { planId: OLD, localDate: '2030-01-01', state: 'taken' } },
      { name: 'list-after-status', path: '/api/preventives', volatile: ['id', 'createdAt', 'updatedAt', 'pausedAt', 'stoppedAt'] },
      { name: 'due-after', path: '/api/preventives/due' },
      { name: 'delete', method: 'DELETE', path: `/api/preventives/${WEEK}` },
      { name: 'delete-bad-id', method: 'DELETE', path: '/api/preventives/abc' },
      { name: 'list-final', path: '/api/preventives', volatile: ['id', 'createdAt', 'updatedAt', 'pausedAt', 'stoppedAt'] },
    ],
  },
];

export default scenarios;
