import { describe, expect, it } from 'vitest';

import { buildAppointmentPrepSnapshot } from './summary';

describe('buildAppointmentPrepSnapshot', () => {
  it('builds a concise appointment snapshot from tracked data', () => {
    const snapshot = buildAppointmentPrepSnapshot({
      compareWindowDays: 90,
      outcomes: {
        totals: {
          mmdMin: 6,
          mhdMin: 10,
          acuteMedicationDays: 4,
          coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
        },
      },
      questionnaires: {
        hit6: { score: 61 },
        midas: { score: 18 },
      },
      preventives: ['Topiramate'],
      attackStats: {
        totalAttacks: 8,
        avgIntensity: 4,
      },
    });

    expect(snapshot).toEqual({
      compareWindowDays: 90,
      coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
      attackStats: { totalAttacks: 8, avgIntensity: 4 },
      currentSnapshot: {
        headacheBurden: { migraineDays: 6, headacheDays: 10 },
        acuteMedicationDays: 4,
        preventiveNames: ['Topiramate'],
        questionnaireScores: {
          hit6: 61,
          midas: 18,
        },
      },
      whatChangedKeys: ['coverage_summary', 'attack_summary'],
      questionPromptKeys: ['treatment_adjustment', 'acute_medication_safety'],
    });
  });
});
