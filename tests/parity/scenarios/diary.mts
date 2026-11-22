import type { Scenario } from '../run.mts';

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const at = (daysAgo: number, hour: number) => `${ymd(daysAgo)}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const scenarios: Scenario[] = [
  {
    name: 'diary entries and attack rules',
    sql: [
      `DELETE FROM episode WHERE user_id = 'e2e_user_test_001'`,
      `DELETE FROM daily_diary_entry WHERE user_id = 'e2e_user_test_001'`,
      `INSERT INTO user_outcome_settings (user_id, timezone) VALUES ('e2e_user_test_001', 'Europe/Berlin') ON CONFLICT (user_id) DO UPDATE SET timezone = 'Europe/Berlin'`,
      `INSERT INTO episode (user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type) VALUES
        ('e2e_user_test_001', 'migraine', '${at(2, 10)}', '${at(2, 12)}', 4, 'LEFT', 'THROBBING'),
        ('e2e_user_test_001', 'headache', '${at(4, 22)}', '${at(3, 2)}', 2, 'RIGHT', 'PRESSURE')`,
    ],
    steps: [
      { name: 'today', path: '/api/diary/today' },
      { name: 'need-type', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(0), patch: { impact: 1 } } },
      { name: 'create', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(0), patch: { dayType: 'headache_free', notes: 'ok', bedTimeLocal: '23:10', wakeTimeLocal: '07:00' } } },
      { name: 'patch', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(0), patch: { impact: 2, notes: null } } },
      { name: 'migraine-down', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(2), patch: { dayType: 'headache_day' } } },
      { name: 'headache-free', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(3), patch: { dayType: 'headache_free' } } },
      { name: 'promote', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(3), patch: { dayType: 'migraine_day', impact: 3 } } },
      { name: 'too-old', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(31), patch: { dayType: 'headache_free' } } },
      { name: 'invalid', method: 'PUT', path: '/api/diary/entry', body: { localDate: 'x', patch: { impact: 7, bedTimeLocal: '24:00' } } },
      { name: 'range', path: `/api/diary/range?from=${ymd(6)}&to=${ymd(0)}` },
      { name: 'range-bad', path: `/api/diary/range?from=${ymd(0)}&to=${ymd(6)}` },
      { name: 'range-missing', path: `/api/diary/range?from=${ymd(0)}` },
      { name: 'overlap', path: `/api/diary/overlap?from=${ymd(6)}&to=${ymd(0)}` },
      { name: 'day', path: `/api/diary/day?date=${ymd(2)}` },
      { name: 'day3', path: `/api/diary/day?date=${ymd(3)}` },
      { name: 'day-bad', path: '/api/diary/day' },
      { name: 'replay', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(1), patch: { dayType: 'headache_free' } }, headers: { 'idempotency-key': 'diary-key-0001' } },
      { name: 'replay2', method: 'PUT', path: '/api/diary/entry', body: { localDate: ymd(1), patch: { dayType: 'headache_free' } }, headers: { 'idempotency-key': 'diary-key-0001' }, compareHeaders: ['idempotent-replayed'] },
    ],
  },
];

export default scenarios;
