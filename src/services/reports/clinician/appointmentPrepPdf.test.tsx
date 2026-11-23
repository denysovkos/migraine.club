import type { ReactNode } from 'react';
import type { ClinicianReportModel } from '@/services/reports/clinician/model';
import { renderToString } from '@react-pdf/renderer';
import { act } from '@testing-library/react';
import { isValidElement } from 'react';

import { describe, expect, it } from 'vitest';

import { AppointmentPrepPdfDocument } from './appointmentPrepPdf';
import { reportModelFixture } from './modelFixture';

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

const model = reportModelFixture;

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
