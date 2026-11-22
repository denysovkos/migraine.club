import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const scenarios: Scenario[] = [
  {
    name: 'cycle tracking',
    sql: [
      `DELETE FROM cycle_bleeding_day WHERE user_id = ${U}`,
      `DELETE FROM cycle_settings WHERE user_id = ${U}`,
      `DELETE FROM episode WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type) VALUES (${U}, '2026-01-03', 'UTC', 'migraine_day')`,
      `INSERT INTO episode (user_id, attack_type, start_time, intensity, pain_location, pain_type) VALUES
        (${U}, 'migraine', '2025-12-30T10:00:00Z', 3, 'LEFT', 'PRESSURE'), (${U}, 'migraine', '2026-01-15T10:00:00Z', 3, 'LEFT', 'PRESSURE'),
        (${U}, 'headache', '2026-01-02T10:00:00Z', 3, 'LEFT', 'PRESSURE')`,
    ],
    steps: [
      { name: 'settings', path: '/api/cycle/settings', volatile: ['updatedAt'] },
      { name: 'settings-put', method: 'PUT', path: '/api/cycle/settings', body: { enabled: true, perimenstrualWindowStartDays: -3, hormoneProfile: 'hrt' }, volatile: ['updatedAt'] },
      { name: 'settings-bad-window', method: 'PUT', path: '/api/cycle/settings', body: { perimenstrualWindowEndDays: 9 } },
      { name: 'settings-bad-order', method: 'PUT', path: '/api/cycle/settings', body: { perimenstrualWindowStartDays: 0, perimenstrualWindowEndDays: 0, enabled: false } },
      { name: 'settings-invalid', method: 'PUT', path: '/api/cycle/settings', body: { privacyMode: 'public', perimenstrualWindowEndDays: 1.5 } },
      { name: 'put', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-01-01', bleeding: true, flow: 'medium' } },
      { name: 'put2', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-01-02', bleeding: true } },
      { name: 'toggle', method: 'POST', path: '/api/cycle/bleeding', body: { localDate: '2026-01-29' } },
      { name: 'toggle-off', method: 'POST', path: '/api/cycle/bleeding', body: { localDate: '2026-01-02' } },
      { name: 'flow', method: 'PATCH', path: '/api/cycle/bleeding', body: { localDate: '2026-01-29', flow: 'heavy' } },
      { name: 'flow-new', method: 'PATCH', path: '/api/cycle/bleeding', body: { localDate: '2026-01-15', flow: 'light' } },
      { name: 'delete', method: 'DELETE', path: '/api/cycle/bleeding?localDate=2026-01-15' },
      { name: 'delete-bad', method: 'DELETE', path: '/api/cycle/bleeding?localDate=15.1' },
      { name: 'invalid', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: 'x', bleeding: 'y', flow: 'z' } },
      { name: 'calendar', path: '/api/cycle/calendar?from=2026-01-01&to=2026-01-31' },
      { name: 'calendar-iso', path: '/api/cycle/calendar?from=2025-12-31T23:00:00-02:00&to=2026-02-01' },
      { name: 'calendar-missing', path: '/api/cycle/calendar?from=2026-01-01' },
      { name: 'calendar-bad', path: '/api/cycle/calendar?from=x&to=2026-01-02' },
      { name: 'context', path: '/api/cycle/context?date=2026-01-03' },
      { name: 'context-before', path: '/api/cycle/context?date=2025-12-20' },
      { name: 'context-bad', path: '/api/cycle/context?date=1.1.2026' },
      { name: 'insights', path: '/api/cycle/insights?from=2025-12-01&to=2026-01-31' },
      { name: 'insights-default', path: '/api/cycle/insights' },
      { name: 'insights-bad', path: '/api/cycle/insights?from=nope' },
      { name: 'delete-all', method: 'DELETE', path: '/api/cycle/data' },
      { name: 'settings-after', path: '/api/cycle/settings' },
    ],
  },
];

export default scenarios;
