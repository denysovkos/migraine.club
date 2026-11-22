import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const SUMA = 'aaaaaaaa-0000-4000-8000-000000000101';
const RIZA = 'aaaaaaaa-0000-4000-8000-000000000102';
const PLAIN = 'aaaaaaaa-0000-4000-8000-000000000103';

const medications = {
  acute: [
    { catalogMedicationId: SUMA },
    { catalogMedicationId: RIZA, medicationClass: 'opioid', defaultDose: ' 10 ', defaultUnit: 'mg' },
    { catalogMedicationId: PLAIN },
    { customName: '  My   Mix ', defaultUnitIsCustom: true, defaultUnit: 'puffs' },
    { customName: 'my mix' },
    { customName: 'Extra' },
  ],
  preventive: [
    { name: ' Topiramate ', kind: 'oral', scheduleType: 'daily', doseText: ' 25 mg ' },
    { name: 'Shot', kind: 'injection', scheduleType: 'every_n_weeks', schedulePayload: { n: 4 }, startDate: '2030-01-01' },
  ],
};

const scenarios: Scenario[] = [
  {
    name: 'intake wizard and seeding',
    sql: [
      `DELETE FROM intake_response WHERE user_id = ${U}`,
      `DELETE FROM preventive_plan WHERE user_id = ${U}`,
      `DELETE FROM factor WHERE user_id = ${U} AND key LIKE 'intake.%'`,
      `INSERT INTO medications_catalog (id, canonical_name, canonical_name_lc, search_text, tags) VALUES
        ('${SUMA}', 'Intake Sumatriptan', 'intake sumatriptan', 'intake sumatriptan', '["triptan","acute"]'),
        ('${RIZA}', 'Intake Rizatriptan', 'intake rizatriptan', 'intake rizatriptan', '["triptan"]'),
        ('${PLAIN}', 'Intake Plain', 'intake plain', 'intake plain', '["acute"]')
        ON CONFLICT (id) DO NOTHING`,
    ],
    steps: [
      { name: 'get-empty', path: '/api/intake' },
      { name: 'patch-habits', method: 'PATCH', path: '/api/intake', body: { block: 'habits', value: { medTiming: 'lt30', typicalWake: '07:00', typicalBed: '23:30', sleepTrouble: 'often', extra: 1 } } },
      { name: 'patch-frequency', method: 'PATCH', path: '/api/intake', body: { value: { band: '4_7' }, block: 'frequency' } },
      { name: 'patch-triggers', method: 'PATCH', path: '/api/intake', body: { block: 'triggers', value: { custom: [], keys: ['stress', ' sleep '] } } },
      { name: 'patch-meds', method: 'PATCH', path: '/api/intake', body: { block: 'medications', value: medications } },
      { name: 'patch-null', method: 'PATCH', path: '/api/intake', body: { block: 'frequency', value: null } },
      { name: 'patch-bad-block', method: 'PATCH', path: '/api/intake', body: { block: 'mood', value: {} } },
      { name: 'patch-invalid', method: 'PATCH', path: '/api/intake', body: { block: 'medications', value: { acute: [{ defaultDose: 'x' }], preventive: [{ name: '', kind: 'pill', scheduleType: 'daily', startDate: 'soon' }] } } },
      { name: 'patch-invalid-habits', method: 'PATCH', path: '/api/intake', body: { block: 'habits', value: { sleepTrouble: 'never', typicalBed: '25:00' } } },
      { name: 'patch-bad-json', method: 'PATCH', path: '/api/intake', rawBody: '{' },
      { name: 'get-progress', path: '/api/intake' },
      { name: 'skip', method: 'POST', path: '/api/intake/skip' },
      { name: 'get-skipped', path: '/api/intake' },
      { name: 'complete', method: 'POST', path: '/api/intake/complete', volatile: ['completedAt'] },
      { name: 'complete-again', method: 'POST', path: '/api/intake/complete', volatile: ['completedAt'] },
      { name: 'skip-after-complete', method: 'POST', path: '/api/intake/skip', volatile: ['completedAt'] },
      { name: 'patch-after-complete', method: 'PATCH', path: '/api/intake', body: { block: 'frequency', value: { band: 'lt1' } }, volatile: ['completedAt'] },
      { name: 'user-meds', path: '/api/user-medications', volatile: ['id', 'userMedicationId', 'createdAt', 'lastUsedAt'] },
      { name: 'preventives', path: '/api/preventives', volatile: ['id', 'createdAt', 'updatedAt'] },
      { name: 'factor-options', path: '/api/factors/options' },
    ],
  },
  {
    // Upstream bug kept for parity: ON CONFLICT (user_id, key) cannot use the
    // partial factor_user_key_uidx, so completion with custom triggers is a 500.
    name: 'intake complete with custom triggers',
    sql: [`DELETE FROM intake_response WHERE user_id = ${U}`],
    steps: [
      { name: 'patch-triggers', method: 'PATCH', path: '/api/intake', body: { block: 'triggers', value: { custom: [' Red  Wine '], keys: [] } } },
      { name: 'complete', method: 'POST', path: '/api/intake/complete' },
      { name: 'get', path: '/api/intake' },
    ],
  },
  {
    name: 'intake complete without answers',
    sql: [`DELETE FROM intake_response WHERE user_id = ${U}`],
    steps: [
      { name: 'complete-empty', method: 'POST', path: '/api/intake/complete', volatile: ['completedAt'] },
      { name: 'get', path: '/api/intake', volatile: ['completedAt'] },
    ],
  },
  {
    name: 'intake bad stored answers',
    sql: [
      `DELETE FROM intake_response WHERE user_id = ${U}`,
      `INSERT INTO intake_response (user_id, version, status, current_step, answers) VALUES (${U}, 1, 'in_progress', 2, '{"frequency": {"band": "never"}}')`,
    ],
    steps: [
      { name: 'get', path: '/api/intake' },
      { name: 'patch', method: 'PATCH', path: '/api/intake', body: { block: 'triggers', value: { keys: [], custom: [] } } },
      { name: 'old-version', method: 'POST', path: '/api/intake/skip' },
    ],
  },
];

export default scenarios;
