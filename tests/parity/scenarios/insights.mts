import type { Scenario } from '../run.mts';

// Run with ENABLE_F39_INSIGHTS=true on both servers to cover the engine;
// without it every step is the "disabled" answer.
const U = `'e2e_user_test_001'`;
const STRESS = 'bbbbbbbb-0000-4000-8000-000000000001';
const WALK = 'bbbbbbbb-0000-4000-8000-000000000002';
const AURA = 'bbbbbbbb-0000-4000-8000-000000000003';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000009';

const scenarios: Scenario[] = [
  {
    name: 'insights engine, cache and test plans',
    sql: [
      `DELETE FROM insights_cache WHERE user_id = ${U}`,
      `DELETE FROM insight_test_plan WHERE user_id = ${U}`,
      `DELETE FROM factor_event WHERE user_id = ${U}`,
      `DELETE FROM episode WHERE user_id = ${U}`,
      `DELETE FROM daily_diary_entry WHERE user_id = ${U}`,
      `INSERT INTO factor (id, user_id, key, type, display_name) VALUES
        ('${STRESS}', ${U}, 'parity.stress', 'trigger', 'Parity stress'),
        ('${WALK}', ${U}, 'parity.walk', 'protector', 'Parity walk'),
        ('${AURA}', ${U}, 'parity.aura', 'symptom', 'Parity aura'),
        ('${OTHER}', 'someone_else', 'parity.other', 'trigger', 'Not mine')
        ON CONFLICT (id) DO NOTHING`,
      `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
        SELECT ${U}, d::date, 'UTC', 'headache_free' FROM generate_series(CURRENT_DATE - 95, CURRENT_DATE, interval '1 day') d`,
      `INSERT INTO episode (user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type)
        SELECT ${U}, 'migraine', date_trunc('day', now()) - (n * interval '6 day') + interval '10 hour',
          date_trunc('day', now()) - (n * interval '6 day') + interval '13 hour', 3, 'LEFT', 'PRESSURE'
        FROM generate_series(1, 14) n`,
      `INSERT INTO factor_event (user_id, factor_id, occurred_at, source)
        SELECT ${U}, '${STRESS}'::uuid, date_trunc('day', now()) - (n * interval '6 day') + interval '4 hour', 'user' FROM generate_series(1, 14) n
        UNION ALL SELECT ${U}, '${AURA}'::uuid, date_trunc('day', now()) - (n * interval '6 day') + interval '9 hour', 'user' FROM generate_series(1, 12) n
        UNION ALL SELECT ${U}, '${WALK}'::uuid, date_trunc('day', now()) - (n * interval '1 day') + interval '18 hour', 'user'
          FROM generate_series(1, 85) n WHERE n % 6 NOT IN (0, 1)`,
    ],
    steps: [
      { name: 'get', path: '/api/insights', volatile: ['runtimeMs'] },
      { name: 'get-cached', path: '/api/insights?window=90', volatile: ['runtimeMs'] },
      { name: 'get-30', path: '/api/insights?windowDays=30', volatile: ['runtimeMs'] },
      { name: 'get-bad-window', path: '/api/insights?windowDays=45' },
      { name: 'recompute-recent', method: 'POST', path: '/api/insights/recompute', body: { windowDays: 90 }, volatile: ['runtimeMs'] },
      { name: 'recompute-180', method: 'POST', path: '/api/insights/recompute', body: { windowDays: '180' }, volatile: ['runtimeMs'] },
      { name: 'recompute-bad', method: 'POST', path: '/api/insights/recompute', body: { windowDays: 7 } },
      { name: 'recompute-junk-body', method: 'POST', path: '/api/insights/recompute', rawBody: 'nope' },
      { name: 'plans-empty', path: '/api/insights/test-plans' },
      { name: 'plan-create', method: 'POST', path: '/api/insights/test-plans', body: { factorId: STRESS, direction: 'reduce', startDate: '2026-02-30', notes: 'less', durationDays: 7 }, volatile: ['id'] },
      { name: 'plan-create-default', method: 'POST', path: '/api/insights/test-plans', body: { factorId: WALK, direction: 'increase', startDate: '2020-01-01', reminderEnabled: false }, volatile: ['id'] },
      { name: 'plan-create-invalid', method: 'POST', path: '/api/insights/test-plans', body: { factorId: 'x', direction: 'up', startDate: 'soon' } },
      { name: 'plan-create-month13', method: 'POST', path: '/api/insights/test-plans', body: { factorId: STRESS, direction: 'reduce', startDate: '2026-13-01' } },
      { name: 'plans', path: '/api/insights/test-plans', volatile: ['id', 'createdAt', 'updatedAt'] },
      { name: 'plans-active', path: '/api/insights/test-plans?status=active', volatile: ['id', 'createdAt', 'updatedAt'] },
      { name: 'plans-bad-status', path: '/api/insights/test-plans?status=done' },
      { name: 'plan-patch-bad-id', method: 'PATCH', path: '/api/insights/test-plans/abc', body: { notes: 'x' } },
      { name: 'plan-patch-invalid', method: 'PATCH', path: '/api/insights/test-plans/00000000-0000-4000-8000-000000000000', body: { status: 'active' } },
      { name: 'plan-patch-missing', method: 'PATCH', path: '/api/insights/test-plans/00000000-0000-4000-8000-000000000000', body: { status: 'completed' } },
    ],
  },
  {
    name: 'insights stale cache',
    sql: [
      `DELETE FROM insights_cache WHERE user_id = ${U}`,
      `INSERT INTO insights_cache (user_id, window_days, method_version, computed_at, stale, payload_json, input_stats_json)
        VALUES (${U}, 60, 'f39_v2_cc_wilson_bh_v1', now() - interval '1 hour', false, '{"cached": true, "b": [1, 2]}', '{}')`,
    ],
    steps: [
      { name: 'fresh-cache', path: '/api/insights?windowDays=60' },
      { name: 'recompute-recent', method: 'POST', path: '/api/insights/recompute', body: { windowDays: 60 }, volatile: ['runtimeMs'] },
    ],
  },
];

export default scenarios;
