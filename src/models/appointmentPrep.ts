export type AppointmentPrepSnapshot = {
  compareWindowDays: number;
  coverage: {
    totalDays: number;
    recordedDays: number;
    missingDays: number;
  };
  attackStats: {
    totalAttacks: number;
    avgIntensity: number | null;
  };
  currentSnapshot: {
    headacheBurden: {
      migraineDays: number;
      headacheDays: number;
    };
    acuteMedicationDays: number;
    preventiveNames: string[];
    questionnaireScores: {
      hit6: number | null;
      midas: number | null;
    };
  };
  whatChangedKeys: string[];
  questionPromptKeys: string[];
};
