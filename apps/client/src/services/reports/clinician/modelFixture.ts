import type { ClinicianReportModel } from '@/services/reports/clinician/model';

import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';

/** A filled-in report model for rendering tests. */
export const reportModelFixture: ClinicianReportModel = {
  title: 'Migrennity Clinician Report',
  generatedAtIso: '2026-04-05T12:00:00.000Z',
  timezone: 'America/New_York',
  config: clinicianReportConfigSchema.parse({
    template: 'custom',
    rangePreset: 'custom',
    from: '2026-03-01',
    to: '2026-04-05',
  }),
  appointmentPrep: {
    appointmentDate: '2026-04-12',
    visitLabel: 'Next Appointment Prep',
    clinicianName: 'Dr. Rivera',
    visitReason: 'Worsening migraine frequency and new visual symptoms',
    topConcerns: [
      'More migraine days',
      'Breakthrough attacks at work',
      'Light sensitivity',
    ],
    doctorQuestions: [
      'Should we change preventives?',
      'Do I need imaging before the visit?',
      'What should I track between now and then?',
    ],
    personalNotes: 'Bring the medication list, trigger notes, and last three attacks.',
    generatedSnapshot: {
      compareWindowDays: 30,
      coverage: {
        totalDays: 30,
        recordedDays: 27,
        missingDays: 3,
      },
      attackStats: {
        totalAttacks: 9,
        avgIntensity: 7.2,
      },
      currentSnapshot: {
        headacheBurden: {
          migraineDays: 8,
          headacheDays: 11,
        },
        acuteMedicationDays: 6,
        preventiveNames: ['Topiramate', 'Magnesium glycinate'],
        questionnaireScores: {
          hit6: 66,
          midas: 18,
        },
      },
      whatChangedKeys: [
        'more_frequent_attacks',
        'new_visual_symptoms',
      ],
      questionPromptKeys: [
        'treatment_adjustment',
        'imaging_question',
        'tracking_question',
      ],
    },
  },
  range: {
    from: '2026-03-01',
    to: '2026-04-05',
    label: '2026-03-01 to 2026-04-05',
  },
  sections: ['summary'],
  identity: {
    name: 'Ada Lovelace',
  },
  dataQuality: {
    totalDays: 30,
    trackedDays: 27,
    missingDays: 3,
    trackedPct: 90,
    qualityLine: '27/30 tracked days (90%)',
  },
  outcomes: {
    mmd: 8,
    mhd: 11,
    acuteMedicationDays: 6,
  },
  moh: {
    status: 'watch',
    title: 'MOH watch',
    text: 'Acute medication use is approaching the watch threshold.',
  },
  questionnaires: {
    hit6: { score: 66, takenAt: '2026-04-01' },
    midas: { score: 18, takenAt: '2026-04-02' },
    msq: { score: null, takenAt: null },
  },
  medications: {
    currentPreventives: ['Topiramate', 'Magnesium glycinate'],
    topAcuteMeds: [
      { name: 'Sumatriptan', usageDays: 4 },
      { name: 'Ibuprofen', usageDays: 2 },
    ],
  },
  trends: {
    weeklyAttackStarts: [
      { weekStart: '2026-03-02', count: 2 },
      { weekStart: '2026-03-09', count: 1 },
    ],
  },
  attacks: {
    total: 9,
    pageSize: 24,
    pages: [],
  },
  diary: {
    days: [
      { date: '2026-03-01', dayType: 'migraine_day', impact: 8 },
      { date: '2026-03-02', dayType: 'headache_day', impact: 4 },
    ],
  },
  cycleHormones: null,
  disclaimers: [
    'This report is informational only and is not a diagnosis.',
    'Please discuss all treatment decisions with a licensed clinician.',
  ],
};
