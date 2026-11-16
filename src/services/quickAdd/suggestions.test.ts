import { computeTopSuggestions } from '@/services/quickAdd/suggestions';

describe('computeTopSuggestions', () => {
  const now = new Date('2025-01-10T12:00:00.000Z');

  it('filters to the last 90 days and orders by count desc then lastUsedAt desc', () => {
    const meds = [
      { userMedicationId: 'a', label: 'A', defaultDose: null, defaultUnit: null, defaultUnitIsCustom: false },
      { userMedicationId: 'b', label: 'B', defaultDose: null, defaultUnit: null, defaultUnitIsCustom: false },
    ];

    const intakes = [
      // A: 2 within window
      { userMedicationId: 'a', takenAt: new Date('2025-01-09T12:00:00.000Z'), dose: '50', unit: 'mg', unitIsCustom: false },
      { userMedicationId: 'a', takenAt: new Date('2024-12-01T12:00:00.000Z'), dose: '50', unit: 'mg', unitIsCustom: false },
      // A: 1 outside window (should be ignored)
      { userMedicationId: 'a', takenAt: new Date('2024-08-01T12:00:00.000Z'), dose: '50', unit: 'mg', unitIsCustom: false },
      // B: 2 within window, lastUsedAt newer => should come first (tie on count)
      { userMedicationId: 'b', takenAt: new Date('2025-01-10T11:00:00.000Z'), dose: '10', unit: 'mg', unitIsCustom: false },
      { userMedicationId: 'b', takenAt: new Date('2024-11-15T12:00:00.000Z'), dose: '10', unit: 'mg', unitIsCustom: false },
    ];

    const res = computeTopSuggestions({ now, intakes, meds, windowDays: 90, limit: 5 });

    expect(res.map(r => r.userMedicationId)).toEqual(['b', 'a']);
  });

  it('uses precedence default -> mode -> last', () => {
    const meds = [
      { userMedicationId: 'a', label: 'A', defaultDose: '100', defaultUnit: 'mg', defaultUnitIsCustom: false },
      { userMedicationId: 'b', label: 'B', defaultDose: null, defaultUnit: null, defaultUnitIsCustom: false },
      { userMedicationId: 'c', label: 'C', defaultDose: null, defaultUnit: null, defaultUnitIsCustom: false },
    ];

    const intakes = [
      // a: defaults should win
      { userMedicationId: 'a', takenAt: new Date('2025-01-09T12:00:00.000Z'), dose: '25', unit: 'mg', unitIsCustom: false },
      // b: mode is 50mg (2x) even though last is 100mg
      { userMedicationId: 'b', takenAt: new Date('2025-01-09T12:00:00.000Z'), dose: '50', unit: 'mg', unitIsCustom: false },
      { userMedicationId: 'b', takenAt: new Date('2025-01-08T12:00:00.000Z'), dose: '50', unit: 'mg', unitIsCustom: false },
      { userMedicationId: 'b', takenAt: new Date('2025-01-10T11:00:00.000Z'), dose: '100', unit: 'mg', unitIsCustom: false },
      // c: no mode (all distinct), should use last
      { userMedicationId: 'c', takenAt: new Date('2025-01-07T12:00:00.000Z'), dose: '1', unit: 'tablet(s)', unitIsCustom: false },
      { userMedicationId: 'c', takenAt: new Date('2025-01-09T12:00:00.000Z'), dose: '2', unit: 'tablet(s)', unitIsCustom: false },
    ];

    const res = computeTopSuggestions({ now, intakes, meds, windowDays: 90, limit: 5 });
    const byId = new Map(res.map(r => [r.userMedicationId, r]));

    expect(byId.get('a')?.suggestedDose).toBe('100');
    expect(byId.get('a')?.suggestedUnit).toBe('mg');

    expect(byId.get('b')?.suggestedDose).toBe('50');
    expect(byId.get('b')?.suggestedUnit).toBe('mg');

    expect(byId.get('c')?.suggestedDose).toBe('2');
    expect(byId.get('c')?.suggestedUnit).toBe('tablet(s)');
  });
});
