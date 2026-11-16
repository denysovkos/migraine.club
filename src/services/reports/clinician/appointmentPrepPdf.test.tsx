import type { ReactNode } from 'react';
import type { ClinicianReportModel } from '@/services/reports/clinician/model';
import { renderToString } from '@react-pdf/renderer';
import { act } from '@testing-library/react';
import { isValidElement } from 'react';

import { describe, expect, it } from 'vitest';
import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';

import { AppointmentPrepPdfDocument } from './appointmentPrepPdf';

function extractElementText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractElementText).join(' ');
  }

  if (!node || !isValidElement(node)) {
    return '';
  }

  if (typeof node.type === 'function') {
    const componentType = node.type as {
      (props: Record<string, unknown>): ReactNode;
      prototype?: { isReactComponent?: unknown };
    };

    if (!componentType.prototype?.isReactComponent) {
      return extractElementText(componentType(node.props as Record<string, unknown>));
    }
  }

  return extractElementText((node.props as { children?: ReactNode }).children);
}

const model: ClinicianReportModel = {
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

describe('AppointmentPrepPdfDocument', () => {
  it('renders the appointment-prep summary copy for a clinician visit', async () => {
    let rendered = '';
    await act(async () => {
      rendered = await renderToString(<AppointmentPrepPdfDocument model={model} />);
    });
    const documentTree = AppointmentPrepPdfDocument({ model });
    const extractedText = extractElementText(documentTree);

    expect(rendered.startsWith('%PDF-')).toBe(true);
    expect(extractedText).toContain('Migrennity');
    expect(extractedText).toContain('Next Appointment Prep');
    expect(extractedText).not.toContain('Warm-clinical visit summary');
    expect(extractedText).toMatch(/Why I'm here/);
    expect(extractedText).toContain('Questions for my doctor');
    expect(extractedText).toContain('Why this matters for the visit');
  });

  it('uses a saved visit label in the visible appointment-prep headline', () => {
    const customLabelModel: ClinicianReportModel = {
      ...model,
      appointmentPrep: model.appointmentPrep && {
        ...model.appointmentPrep,
        visitLabel: 'Neurology Follow-up Plan',
      },
    };

    const documentTree = AppointmentPrepPdfDocument({ model: customLabelModel });
    const extractedText = extractElementText(documentTree);
    const headlineIndex = extractedText.indexOf('Neurology Follow-up Plan');
    const visitLabelCardIndex = extractedText.indexOf('Visit label');

    expect(extractedText).toContain('Neurology Follow-up Plan');
    expect(headlineIndex).toBeGreaterThan(-1);
    expect(visitLabelCardIndex).toBeGreaterThan(headlineIndex);
  });

  it('renders supporting detail pages with selective explanations and compact visuals', () => {
    const detailModel: ClinicianReportModel = {
      ...model,
      appointmentPrep: model.appointmentPrep && {
        ...model.appointmentPrep,
        generatedSnapshot: {
          ...model.appointmentPrep.generatedSnapshot,
          whatChangedKeys: ['coverage_summary', 'attack_summary'],
          questionPromptKeys: ['treatment_adjustment', 'acute_medication_safety'],
        },
      },
      trends: {
        weeklyAttackStarts: [
          { weekStart: '2026-03-02', count: 2 },
          { weekStart: '2026-03-09', count: 1 },
          { weekStart: '2026-03-16', count: 3 },
          { weekStart: '2026-03-23', count: 2 },
        ],
      },
    };

    const documentTree = AppointmentPrepPdfDocument({ model: detailModel });
    const extractedText = extractElementText(documentTree);

    expect(extractedText).toContain('What changed recently');
    expect(extractedText).toContain('Medication and treatment context');
    expect(extractedText).toContain('Questionnaire scores');
    expect(extractedText).toContain('Personal notes');
    expect(extractedText).toContain('Recorded days: 27/30');
    expect(extractedText).toContain('9 attacks logged in the last 30 days');
    expect(extractedText).toContain('Current preventive plan');
    expect(extractedText).toContain('Review whether the current prevention plan');
    expect(extractedText).toContain('Recent weekly attack starts');
    expect(extractedText).toContain('Tracking quality over the snapshot window');
    expect(extractedText).toContain('What to notice');
    expect(extractedText).toContain('Discussion prompts and pattern notes');
  });

  it('falls back to the raw key text for unknown generated explanations', () => {
    const fallbackModel: ClinicianReportModel = {
      ...model,
      appointmentPrep: model.appointmentPrep && {
        ...model.appointmentPrep,
        generatedSnapshot: {
          ...model.appointmentPrep.generatedSnapshot,
          whatChangedKeys: ['new_visual_symptoms'],
          questionPromptKeys: ['tracking_question'],
        },
      },
    };

    const documentTree = AppointmentPrepPdfDocument({ model: fallbackModel });
    const extractedText = extractElementText(documentTree);

    expect(extractedText).toContain('new_visual_symptoms');
    expect(extractedText).toContain('tracking_question');
  });
});
