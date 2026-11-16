export type MedicationDoseSnapshot = {
  defaultDose: string | null;
  defaultUnit: string | null;
  defaultUnitIsCustom: boolean;
  lastUsedDose: string | null;
  lastUsedUnit: string | null;
  lastUsedUnitIsCustom: boolean;
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeDoseInput(value: string): string {
  const normalized = value
    .replace(',', '.')
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1');

  if (!normalized) {
    return '';
  }

  if (normalized === '.') {
    return '';
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return '';
  }

  return String(parsed);
}

export function hasKnownDose(medication: MedicationDoseSnapshot): boolean {
  return Boolean(
    medication.lastUsedDose?.trim()
    || medication.defaultDose?.trim(),
  );
}

export function resolveKnownDose(medication: MedicationDoseSnapshot): {
  dose: string | null;
  unit: string | null;
  unitIsCustom: boolean;
} {
  if (medication.lastUsedDose?.trim()) {
    return {
      dose: medication.lastUsedDose.trim(),
      unit: medication.lastUsedUnit?.trim() || 'mg',
      unitIsCustom: medication.lastUsedUnitIsCustom,
    };
  }

  if (medication.defaultDose?.trim()) {
    return {
      dose: medication.defaultDose.trim(),
      unit: medication.defaultUnit?.trim() || 'mg',
      unitIsCustom: medication.defaultUnitIsCustom,
    };
  }

  return {
    dose: null,
    unit: medication.lastUsedUnit?.trim() || medication.defaultUnit?.trim() || 'mg',
    unitIsCustom: medication.lastUsedUnitIsCustom || medication.defaultUnitIsCustom,
  };
}

export function getOneTapDecision(medication: MedicationDoseSnapshot): 'log-now' | 'select' {
  return hasKnownDose(medication) ? 'log-now' : 'select';
}
