import {
  getOneTapDecision,
  normalizeDoseInput,
  normalizeSearchText,
} from '@/features/quickAdd/medicationPickerLogic';

describe('medicationPickerLogic', () => {
  it('normalizes search text (trim, lowercase, diacritics)', () => {
    expect(normalizeSearchText('  SÚMA   Triptán  ')).toBe('suma triptan');
  });

  it('parses dose with comma and period separators', () => {
    expect(normalizeDoseInput('12,5')).toBe('12.5');
    expect(normalizeDoseInput('12.5')).toBe('12.5');
  });

  it('uses one-tap logging only when known dose exists', () => {
    expect(
      getOneTapDecision({
        defaultDose: null,
        defaultUnit: 'mg',
        defaultUnitIsCustom: false,
        lastUsedDose: '50',
        lastUsedUnit: 'mg',
        lastUsedUnitIsCustom: false,
      }),
    ).toBe('log-now');

    expect(
      getOneTapDecision({
        defaultDose: null,
        defaultUnit: 'mg',
        defaultUnitIsCustom: false,
        lastUsedDose: null,
        lastUsedUnit: null,
        lastUsedUnitIsCustom: false,
      }),
    ).toBe('select');
  });
});
