import type { Scenario } from '../run.mts';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const U = `'e2e_user_test_001'`;

const scenarios: Scenario[] = [
  {
    name: 'quick-add intakes, acute doses and outcomes',
    sql: [
      `DELETE FROM episode WHERE user_id = ${U}`,
      `DELETE FROM medication_intakes WHERE user_id = ${U}`,
      `DELETE FROM acute_doses WHERE user_id = ${U}`,
      `DELETE FROM user_medications WHERE user_id = ${U}`,
      `INSERT INTO episode (user_id, start_time, is_ongoing, intensity, pain_location, pain_type) VALUES (${U}, '${ago(60)}', true, 3, 'OTHER', 'OTHER')`,
      `INSERT INTO user_medications (id, user_id, custom_name, medication_class, is_acute, default_dose, default_unit) VALUES ('11111111-1111-4111-8111-111111111111', ${U}, 'Sumatriptan', 'triptan', true, '50', 'mg')`,
    ],
    steps: [
      { name: 'suggest-empty', path: '/api/quick-add/suggestions' },
      { name: 'intake', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: '  Ibuprofen  400 ', dose: ' 400 ', unit: 'mg', recordAcuteDose: true } },
      { name: 'intake2', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: 'ibuprofen 400', takenAt: ago(120) } },
      { name: 'intake3', method: 'POST', path: '/api/quick-add/medication-intake', body: { userMedicationId: '11111111-1111-4111-8111-111111111111' } },
      { name: 'too-old', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: 'X', takenAt: ago(60 * 24 * 8) } },
      { name: 'future', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: 'X', takenAt: ago(-60) } },
      { name: 'none', method: 'POST', path: '/api/quick-add/medication-intake', body: { dose: '1' } },
      { name: 'bad-episode', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: 'X', episodeId: 999999 } },
      { name: 'bad-med', method: 'POST', path: '/api/quick-add/medication-intake', body: { userMedicationId: '22222222-2222-4222-8222-222222222222' } },
      { name: 'suggest', path: '/api/quick-add/suggestions', volatile: ['score'] },
      { name: 'patch', method: 'PATCH', path: '/api/quick-add/medication-intake/intake:{{intake.body.intakeId}}', body: { dose: null, unit: 'g', unitIsCustom: true } },
      { name: 'patch-acute', method: 'PATCH', path: '/api/quick-add/medication-intake/acute:{{intake.body.acuteDoseId}}', body: { dose: '200' } },
      { name: 'patch-empty', method: 'PATCH', path: '/api/quick-add/medication-intake/{{intake.body.intakeId}}', body: {} },
      { name: 'patch-bad-id', method: 'PATCH', path: '/api/quick-add/medication-intake/nope', body: { unit: 'g' } },
      { name: 'dose', method: 'POST', path: '/api/acute-doses', body: { medicationId: '11111111-1111-4111-8111-111111111111', dose: '50', notes: ' a\tb ' } },
      { name: 'dose-bad-attack', method: 'POST', path: '/api/acute-doses', body: { medicationId: '11111111-1111-4111-8111-111111111111', attackId: 999999 } },
      { name: 'dose-bad-med', method: 'POST', path: '/api/acute-doses', body: { medicationId: '22222222-2222-4222-8222-222222222222' } },
      { name: 'dose-invalid', method: 'POST', path: '/api/acute-doses', body: { medicationId: 'x', dose: '' } },
      { name: 'outcome', method: 'POST', path: '/api/dose-outcomes', body: { doseId: '{{dose.body.doseId}}', helped: 'partly', backToNormalFunction: false, timeToReliefMinutes: 30 } },
      { name: 'outcome2', method: 'POST', path: '/api/dose-outcomes', body: { doseId: '{{dose.body.doseId}}', helped: 'yes' } },
      { name: 'outcome-missing', method: 'POST', path: '/api/dose-outcomes', body: { doseId: '22222222-2222-4222-8222-222222222222', helped: 'no' } },
      { name: 'outcome-invalid', method: 'POST', path: '/api/dose-outcomes', body: { doseId: 'x', helped: 'maybe' } },
      { name: 'delete', method: 'DELETE', path: '/api/quick-add/medication-intake/{{intake2.body.intakeId}}' },
      { name: 'delete-again', method: 'DELETE', path: '/api/quick-add/medication-intake/{{intake2.body.intakeId}}' },
      { name: 'delete-bad', method: 'DELETE', path: '/api/quick-add/medication-intake/nope' },
    ],
  },
];

export default scenarios;
