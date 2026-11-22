import type { Scenario } from '../run.mts';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const days = (d: number) => ago(d * 24 * 60);

const scenarios: Scenario[] = [
  {
    name: 'quick attack lifecycle',
    sql: [`DELETE FROM episode WHERE user_id = 'e2e_user_test_001'`, `DELETE FROM daily_diary_entry WHERE user_id = 'e2e_user_test_001'`],
    steps: [
      { name: 'headache', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 3, attackType: 'headache', startTime: ago(30) } },
      { name: 'conflict', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 3, attackType: 'headache' } },
      { name: 'migraine', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 4, startTime: ago(10), onsetAt: ago(20) } },
      { name: 'old', path: '/api/episodes/{{headache.body.id}}' },
      { name: 'readings-empty', path: '/api/episodes/{{migraine.body.id}}/pain-readings' },
      { name: 'reading1', method: 'POST', path: '/api/episodes/{{migraine.body.id}}/pain-readings', body: { intensity: 5, recordedAt: ago(15) } },
      { name: 'reading2', method: 'POST', path: '/api/episodes/{{migraine.body.id}}/pain-readings', body: { intensity: 2, recordedAt: ago(5) } },
      { name: 'reading-early', method: 'POST', path: '/api/episodes/{{migraine.body.id}}/pain-readings', body: { intensity: 2, recordedAt: ago(60) } },
      { name: 'reading-bad', method: 'POST', path: '/api/episodes/{{migraine.body.id}}/pain-readings', body: { intensity: 9 } },
      { name: 'reading-notjson', method: 'POST', path: '/api/episodes/{{migraine.body.id}}/pain-readings', rawBody: 'x' },
      { name: 'readings', path: '/api/episodes/{{migraine.body.id}}/pain-readings' },
      { name: 'delete-reading', method: 'DELETE', path: '/api/episodes/{{migraine.body.id}}/pain-readings/{{reading1.body.reading.id}}' },
      { name: 'delete-reading-bad', method: 'DELETE', path: '/api/episodes/{{migraine.body.id}}/pain-readings/nope' },
      { name: 'end-bad', method: 'PATCH', path: '/api/episodes/{{migraine.body.id}}', body: { endTime: ago(1) } },
      { name: 'end', method: 'PATCH', path: '/api/episodes/{{migraine.body.id}}', body: { endNow: true, endedAt: ago(2), notes: 'better', symptoms: ['NAUSEA', 'AURA'], triggers: ['STRESS'] } },
      { name: 'detail', path: '/api/episodes/{{migraine.body.id}}' },
      { name: 'list', path: '/api/episodes?limit=5' },
      { name: 'recent', path: '/api/episodes/recent?limit=2' },
      { name: 'delete', method: 'DELETE', path: '/api/episodes/{{headache.body.id}}' },
      { name: 'delete-again', method: 'DELETE', path: '/api/episodes/{{headache.body.id}}' },
      { name: 'list2', path: '/api/episodes' },
    ],
  },
  {
    name: 'full attack create, validation and window',
    sql: [`DELETE FROM episode WHERE user_id = 'e2e_user_test_001'`],
    steps: [
      { name: 'full', method: 'POST', path: '/api/episodes', body: { startTime: days(1), endTime: ago(60), intensity: 4, painLocation: 'LEFT', painType: 'THROBBING', symptoms: ['PHOTOPHOBIA'], protectors: ['REST'], notes: 'n' } },
      { name: 'invalid', method: 'POST', path: '/api/episodes', body: { intensity: 7, painLocation: 'NOSE', painType: 'THROBBING', symptoms: ['X'] } },
      { name: 'refine', method: 'POST', path: '/api/episodes', body: { intensity: 2, painLocation: 'LEFT', painType: 'PRESSURE', startTime: ago(10), endTime: ago(20) } },
      { name: 'ongoing-end', method: 'POST', path: '/api/episodes', body: { intensity: 2, painLocation: 'LEFT', painType: 'PRESSURE', isOngoing: true, endTime: ago(20) } },
      { name: 'not-json', method: 'POST', path: '/api/episodes', rawBody: '{' },
      { name: 'old', method: 'POST', path: '/api/episodes', body: { startTime: days(40), endTime: days(39), intensity: 2, painLocation: 'RIGHT', painType: 'PRESSURE' } },
      { name: 'old-type', method: 'PATCH', path: '/api/episodes/{{old.body.id}}', body: { attackType: 'headache' } },
      { name: 'old-notes', method: 'PATCH', path: '/api/episodes/{{old.body.id}}', body: { notes: 'later' } },
      { name: 'patch-invalid', method: 'PATCH', path: '/api/episodes/{{full.body.id}}', body: { intensity: 0, painType: 'X' } },
      { name: 'patch-order', method: 'PATCH', path: '/api/episodes/{{full.body.id}}', body: { startTime: ago(10), endTime: ago(20) } },
      { name: 'patch-missing', method: 'PATCH', path: '/api/episodes/999999', body: { notes: 'x' } },
      { name: 'get-bad', path: '/api/episodes/abc' },
      { name: 'page', path: '/api/episodes?page=2&limit=1' },
      { name: 'bounds', path: `/api/episodes?from=${days(2)}&to=${ago(0)}` },
      { name: 'recent-bad', path: '/api/episodes/recent?limit=0' },
    ],
  },
  {
    name: 'idempotent offline writes',
    sql: [`DELETE FROM episode WHERE user_id = 'e2e_user_test_001'`, `DELETE FROM idempotent_request WHERE user_id = 'e2e_user_test_001'`],
    steps: [
      { name: 'first', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 2 }, headers: { 'idempotency-key': 'parity-key-0001' }, compareHeaders: ['idempotent-replayed'] },
      { name: 'replay', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 2 }, headers: { 'idempotency-key': 'parity-key-0001' }, compareHeaders: ['idempotent-replayed'] },
      { name: 'bad-key', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 2 }, headers: { 'idempotency-key': 'x' } },
      { name: 'other-user', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 2 }, headers: { 'x-offline-user': 'someone-else' } },
      { name: 'end', method: 'PATCH', path: '/api/episodes/{{first.body.id}}', body: { endNow: true }, headers: { 'idempotency-key': 'parity-key-0002' } },
      { name: 'end-replay', method: 'PATCH', path: '/api/episodes/{{first.body.id}}', body: { endNow: true }, headers: { 'idempotency-key': 'parity-key-0002' }, compareHeaders: ['idempotent-replayed'] },
    ],
  },
  {
    name: 'consent required',
    sql: [`UPDATE user_consent SET withdrawn_at = now() WHERE user_id = 'e2e_user_test_001' AND consent_type = 'health_data'`],
    steps: [
      { name: 'create', method: 'POST', path: '/api/episodes', body: { mode: 'quick', intensity: 2 } },
    ],
  },
];

export default scenarios;

scenarios.push({
  name: 'quick-add episode',
  sql: [`DELETE FROM episode WHERE user_id = 'e2e_user_test_001'`, `DELETE FROM daily_diary_entry WHERE user_id = 'e2e_user_test_001'`],
  steps: [
    { name: 'headache', method: 'POST', path: '/api/quick-add/episode', body: { attackType: 'headache', startedAt: ago(30), onsetAt: ago(40) } },
    { name: 'upgrade', method: 'POST', path: '/api/quick-add/episode', rawBody: 'not json' },
    { name: 'conflict', method: 'POST', path: '/api/quick-add/episode', body: {} },
    { name: 'historical', method: 'POST', path: '/api/quick-add/episode', body: { localDate: days(5).slice(0, 10), attackType: 'headache' } },
    { name: 'bad-date', method: 'POST', path: '/api/quick-add/episode', body: { localDate: '5 May' } },
    { name: 'too-old', method: 'POST', path: '/api/quick-add/episode', body: { startedAt: days(8) } },
    { name: 'list', path: '/api/episodes' },
    { name: 'diary', path: `/api/diary/range?from=${days(6).slice(0, 10)}&to=${ago(0).slice(0, 10)}` },
  ],
});
