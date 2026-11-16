import type { ClinicianReportModel } from '@/services/reports/clinician/model';

import { describe, expect, it } from 'vitest';
import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';

import { renderClinicianReportHtml } from './renderHtml';

const appointmentPrepModel: ClinicianReportModel = {
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
    topConcerns: ['More migraine days', 'Breakthrough attacks at work'],
    doctorQuestions: ['Should we change preventives?', 'Do I need imaging before the visit?'],
    personalNotes: 'Bring the medication list and trigger notes.',
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
      whatChangedKeys: ['coverage_summary', 'attack_summary'],
      questionPromptKeys: ['treatment_adjustment', 'acute_medication_safety'],
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

describe('renderClinicianReportHtml', () => {
  it('renders appointment-prep previews with the new visit hierarchy', () => {
    const html = renderClinicianReportHtml(appointmentPrepModel);

    expect(html).toContain('Appointment prep');
    expect(html).toContain('Warm-clinical visit summary');
    expect(html).toContain('Next Appointment Prep');
    expect(html).toContain('Appointment date');
    expect(html).toContain('Why I&apos;m going');
    expect(html).toContain('Questions for my clinician');
    expect(html).toContain('What changed recently');
    expect(html).toContain('Coverage summary');
    expect(html).toContain('Recorded days: 27/30');
    expect(html).toContain('Attack summary');
    expect(html).toContain('9 attacks logged in the last 30 days.');
    expect(html).not.toContain('<li>coverage_summary</li>');
    expect(html).not.toContain('<li>attack_summary</li>');
    expect(html).toContain('Generated discussion prompts');
    expect(html).toContain('Current preventive plan');
    expect(html).toContain('Review whether the current prevention plan matches a recent burden of 8 migraine days and 11 headache days.');
    expect(html).toContain('Acute medication safety');
    expect(html).toContain('Acute medication was used on 6 days in this snapshot');
    expect(html).not.toContain('<li>treatment_adjustment</li>');
    expect(html).not.toContain('<li>acute_medication_safety</li>');
    expect(html).toContain('Supporting notes');
    expect(html).toContain('Migraine days');
    expect(html).toContain('Tracking quality');
    expect(html).toContain('27/30 days recorded');
    expect(html).not.toContain('<section class="section"><h2>Summary</h2>');
    expect(html).not.toContain('Tracked days quality');
    expect(html).not.toContain('Top acute meds');
  });
});
