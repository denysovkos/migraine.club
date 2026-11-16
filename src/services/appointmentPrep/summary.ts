import type { AppointmentPrepSnapshot } from '@/models/appointmentPrep';

export type BuildAppointmentPrepSnapshotInput = {
  compareWindowDays: number;
  outcomes: {
    totals: {
      mmdMin: number;
      mhdMin: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
    };
  };
  questionnaires: {
    hit6: { score: number | null };
    midas: { score: number | null };
  };
  preventives: string[];
  attackStats: {
    totalAttacks: number;
    avgIntensity: number | null;
  };
};

export function buildAppointmentPrepSnapshot(
  input: BuildAppointmentPrepSnapshotInput,
): AppointmentPrepSnapshot {
  const { totals } = input.outcomes;
  const { coverage } = totals;

  return {
    compareWindowDays: input.compareWindowDays,
    coverage,
    attackStats: input.attackStats,
    currentSnapshot: {
      headacheBurden: {
        migraineDays: totals.mmdMin,
        headacheDays: totals.mhdMin,
      },
      acuteMedicationDays: totals.acuteMedicationDays,
      preventiveNames: input.preventives,
      questionnaireScores: {
        hit6: input.questionnaires.hit6.score,
        midas: input.questionnaires.midas.score,
      },
    },
    whatChangedKeys: ['coverage_summary', 'attack_summary'],
    questionPromptKeys: ['treatment_adjustment', 'acute_medication_safety'],
  };
}
