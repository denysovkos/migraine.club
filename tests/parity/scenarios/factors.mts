import type { Scenario } from '../run.mts';

const scenarios: Scenario[] = [
  {
    name: 'factor log and options',
    sql: [`DELETE FROM factor_event WHERE user_id = 'e2e_user_test_001'`, `DELETE FROM factor WHERE user_id = 'e2e_user_test_001'`],
    steps: [
      { name: 'options-empty', path: '/api/factors/options' },
      { name: 'log', method: 'POST', path: '/api/factors/log', body: { displayName: ' Stress ', type: 'trigger' } },
      { name: 'log-again', method: 'POST', path: '/api/factors/log', body: { displayName: 'Stress', type: 'trigger', occurredAt: '2026-01-05T10:00:00Z' } },
      { name: 'log-custom', method: 'POST', path: '/api/factors/log', body: { displayName: 'Loud music', type: 'trigger' } },
      { name: 'log-protector', method: 'POST', path: '/api/factors/log', body: { displayName: 'Walk', type: 'protector' } },
      { name: 'log-symptom', method: 'POST', path: '/api/factors/log', body: { displayName: 'Aura', type: 'symptom' } },
      { name: 'log-invalid', method: 'POST', path: '/api/factors/log', body: { displayName: '', type: 'mood' } },
      { name: 'options', path: '/api/factors/options' },
      { name: 'options-day', path: '/api/factors/options?localDate=2026-01-05' },
      { name: 'options-bad', path: '/api/factors/options?localDate=2026-02-30' },
    ],
  },
];

export default scenarios;
