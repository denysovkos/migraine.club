import type { AppointmentPrepSnapshot } from '@migraine/db/appointmentPrep';
// The clinician report model the Go server returns from
// POST /api/reports/clinician/model.
import type { ClinicianReportConfig } from './config';

export type ClinicianReportModel = {
  title: string;
  generatedAtIso: string;
  timezone: string;
  config: ClinicianReportConfig;
  appointmentPrep: null | {
    appointmentDate: string;
    visitLabel: string | null;
    clinicianName: string | null;
    visitReason: string | null;
    topConcerns: string[];
    doctorQuestions: string[];
    personalNotes: string | null;
    generatedSnapshot: AppointmentPrepSnapshot;
  };
  range: {
    from: string;
    to: string;
    label: string;
  };
  sections: string[];
  identity: {
    name: string | null;
  };
  dataQuality: {
    totalDays: number;
    trackedDays: number;
    missingDays: number;
    trackedPct: number;
    qualityLine: string;
  };
  outcomes: {
    mmd: number;
    mhd: number;
    acuteMedicationDays: number;
  };
  moh: {
    status: 'low' | 'watch' | 'high';
    title: string;
    text: string;
  };
  questionnaires: {
    hit6: { score: number | null; takenAt: string | null };
    midas: { score: number | null; takenAt: string | null };
    msq: { score: number | null; takenAt: string | null };
  };
  medications: {
    currentPreventives: string[];
    topAcuteMeds: Array<{ name: string; usageDays: number }>;
  };
  trends: {
    weeklyAttackStarts: Array<{ weekStart: string; count: number }>;
  };
  attacks: {
    total: number;
    pageSize: number;
    pages: ClinicianAttackRow[][];
  };
  diary: {
    days: Array<{ date: string; dayType: string; impact: number | null }>;
  };
  cycleHormones: {
    timeline: Array<{ date: string; bleeding: boolean; migraine: boolean }>;
    attacksInWindow: number;
    totalAttacks: number;
    windowStart: number;
    windowEnd: number;
    hormoneProfile: string | null;
    histogram: Array<{ relativeDay: number; count: number }>;
  } | null;
  disclaimers: string[];
};

export type ClinicianAttackRow = {
  date: string;
  durationHours: number | null;
  maxSeverity: number;
  symptoms: string[];
  acuteMeds: string[];
  effectiveness: string | null;
  impact: number | null;
};
