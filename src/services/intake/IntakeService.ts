// The intake state the Go server returns from /api/intake.
import type { IntakeAnswers, IntakeStatusType } from '@/models/intake';

export type IntakeDTO = {
  status: IntakeStatusType;
  currentStep: number;
  version: number;
  answers: IntakeAnswers;
  completedAt: string | null;
};
