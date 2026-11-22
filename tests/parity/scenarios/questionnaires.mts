import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const msq = Object.fromEntries([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2].map((v, i) => [`q${i + 1}`, v]));

const scenarios: Scenario[] = [
  {
    name: 'questionnaires',
    sql: [`DELETE FROM questionnaire_responses WHERE user_id = ${U}`],
    steps: [
      { name: 'list-empty', path: '/api/questionnaires' },
      { name: 'hit6', method: 'POST', path: '/api/questionnaires', body: { type: 'HIT6', takenAt: '2026-01-02T03:04:05.123456Z', answers: { q6: 'NEVER', q1: 'NEVER', q2: 'RARELY', q3: 'SOMETIMES', q4: 'VERY_OFTEN', q5: 'ALWAYS', extra: 1 } }, volatile: ['createdAt'] },
      { name: 'midas-default-window', method: 'POST', path: '/api/questionnaires', body: { type: 'MIDAS', takenAt: '2026-03-30T10:00:00Z', periodStart: '2026-01-01T00:00:00Z', answers: { q1: 1, q2: 2, q3: 3, q4: 4, q5: 12 } }, volatile: ['createdAt'] },
      { name: 'midas-window', method: 'POST', path: '/api/questionnaires', body: { type: 'MIDAS', takenAt: '2026-02-01T00:00:00Z', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-01-31T00:00:00Z', answers: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 } }, volatile: ['createdAt'] },
      { name: 'msq', method: 'POST', path: '/api/questionnaires', body: { type: 'MSQ21', takenAt: '2026-02-02T00:00:00Z', answers: msq }, volatile: ['createdAt'] },
      { name: 'invalid-type', method: 'POST', path: '/api/questionnaires', body: { type: 'PHQ9', takenAt: 'yesterday', answers: {} } },
      { name: 'invalid-answers', method: 'POST', path: '/api/questionnaires', body: { type: 'MIDAS', answers: { q1: -1, q2: 1.5, q3: 'x' } } },
      { name: 'no-answers', method: 'POST', path: '/api/questionnaires', body: { type: 'HIT6' } },
      { name: 'offset-date', method: 'POST', path: '/api/questionnaires', body: { type: 'HIT6', takenAt: '2026-01-02T03:04:05+02:00', answers: {} } },
      { name: 'bad-json', method: 'POST', path: '/api/questionnaires', rawBody: '{x' },
      { name: 'list', path: '/api/questionnaires', volatile: ['createdAt'] },
      { name: 'list-type', path: '/api/questionnaires?type=MIDAS&limit=1', volatile: ['createdAt'] },
      { name: 'list-bad', path: '/api/questionnaires?type=&limit=0' },
      { name: 'list-limit-str', path: '/api/questionnaires?limit=2.5' },
    ],
  },
];

export default scenarios;
