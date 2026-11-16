import type { ComputeOutcomesResult } from '@/services/outcomes/computeOutcomes';

export type ClinicianOutcomesPack = {
  mmd: number;
  mhd: number;
  acuteMedicationDays: number;
  coverage: {
    totalDays: number;
    recordedDays: number;
    missingDays: number;
  };
};

export function toClinicianOutcomesPack(result: ComputeOutcomesResult): ClinicianOutcomesPack {
  return {
    mmd: result.totals.mmdMin,
    mhd: result.totals.mhdMin,
    acuteMedicationDays: result.totals.acuteMedicationDays,
    coverage: result.totals.coverage,
  };
}
