import { describe, expect, it } from 'vitest';

import { toClinicianOutcomesPack } from '@/services/reports/clinician/outcomesPack';

describe('toClinicianOutcomesPack', () => {
  it('maps computed outcomes to clinician snapshot', () => {
    const result = toClinicianOutcomesPack({
      windowDays: 90,
      timezone: 'UTC',
      totals: {
        mmdMin: 8,
        mmdMax: 8,
        mhdMin: 12,
        mhdMax: 12,
        acuteMedicationDays: 7,
        coverage: {
          totalDays: 90,
          recordedDays: 82,
          missingDays: 8,
        },
      },
      daily: [],
    });

    expect(result).toEqual({
      mmd: 8,
      mhd: 12,
      acuteMedicationDays: 7,
      coverage: {
        totalDays: 90,
        recordedDays: 82,
        missingDays: 8,
      },
    });
  });
});
