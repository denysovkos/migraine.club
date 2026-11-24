import type { AppointmentPrepDraft, AppointmentPrepDraftPatch } from './appointmentPrepApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { vi } from 'vitest';

const baseDraft: AppointmentPrepDraft = {
  id: 'prep-1',
  appointmentDate: '2026-05-01',
  visitLabel: 'Neurology follow-up',
  clinicianName: 'Dr. Smith',
  visitReason: 'Review worsening attacks',
  topConcerns: ['More migraine days'],
  doctorQuestions: ['Should we change preventive treatment?'],
  personalNotes: 'Bring headache diary',
  compareWindowDays: 90,
  createdAt: '2026-04-01T12:00:00.000Z',
  updatedAt: '2026-04-01T12:00:00.000Z',
  generatedSnapshot: {
    compareWindowDays: 90,
    coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
    attackStats: { totalAttacks: 8, avgIntensity: 4 },
    currentSnapshot: {
      headacheBurden: { migraineDays: 6, headacheDays: 10 },
      acuteMedicationDays: 4,
      preventiveNames: ['Topiramate'],
      questionnaireScores: { hit6: 61, midas: 18 },
    },
    whatChangedKeys: ['coverage_summary', 'attack_summary'],
    questionPromptKeys: ['treatment_adjustment', 'acute_medication_safety'],
  },
};

function applyPatch(payload: AppointmentPrepDraftPatch): AppointmentPrepDraft {
  return {
    ...baseDraft,
    appointmentDate: payload.appointmentDate ?? baseDraft.appointmentDate,
    visitLabel: payload.visitLabel ?? baseDraft.visitLabel,
    clinicianName: payload.clinicianName ?? baseDraft.clinicianName,
    visitReason: payload.visitReason ?? baseDraft.visitReason,
    topConcerns: payload.topConcerns ?? baseDraft.topConcerns,
    doctorQuestions: payload.doctorQuestions ?? baseDraft.doctorQuestions,
    personalNotes: payload.personalNotes ?? baseDraft.personalNotes,
  };
}

const {
  exportAppointmentPrepPdfMock,
  getAppointmentPrepMock,
  showSnackbarMock,
  shareAppointmentPrepMock,
  translateMock,
  updateAppointmentPrepMock,
} = vi.hoisted(() => ({
  exportAppointmentPrepPdfMock: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
  getAppointmentPrepMock: vi.fn(async () => baseDraft),
  showSnackbarMock: vi.fn(),
  shareAppointmentPrepMock: vi.fn(async () => 'https://example.com/share/prep-1'),
  translateMock: vi.fn((key: string) => key),
  updateAppointmentPrepMock: vi.fn(async (_id: string, payload: AppointmentPrepDraftPatch): Promise<AppointmentPrepDraft> => applyPatch(payload)),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translateMock,
}));

vi.mock('@/features/snackbar', () => ({
  showSnackbar: showSnackbarMock,
}));

vi.mock('./appointmentPrepApi', () => ({
  createAppointmentPrepShareLink: shareAppointmentPrepMock,
  exportAppointmentPrepPdf: exportAppointmentPrepPdfMock,
  getAppointmentPrep: getAppointmentPrepMock,
  updateAppointmentPrep: updateAppointmentPrepMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('AppointmentPrepEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:mock'),
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('shows the generated snapshot and saves edited visit details', async () => {
    const { AppointmentPrepEditor } = await import('./AppointmentPrepEditor');

    render(<AppointmentPrepEditor prepId="prep-1" />);

    expect(await screen.findByDisplayValue('Review worsening attacks')).toBeInTheDocument();
    expect(screen.getByText('coverage_summary')).toBeInTheDocument();
    expect(screen.getByText('attack_summary')).toBeInTheDocument();
    expect(screen.getByText('treatment_adjustment')).toBeInTheDocument();
    expect(screen.getByText('acute_medication_safety')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('visit_reason'), {
      target: { value: 'Discuss current treatment response' },
    });
    fireEvent.change(screen.getByLabelText('top_concerns'), {
      target: { value: 'More migraine days\nMissing medication days' },
    });
    fireEvent.change(screen.getByLabelText('doctor_questions'), {
      target: { value: 'Should we change preventive treatment?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(updateAppointmentPrepMock).toHaveBeenCalledWith(
        'prep-1',
        expect.objectContaining({
          visitReason: 'Discuss current treatment response',
          topConcerns: ['More migraine days', 'Missing medication days'],
          doctorQuestions: ['Should we change preventive treatment?'],
        }),
      );
    });
  });

  it('disables share while the share link is being created and avoids duplicate triggers', async () => {
    const shareRequest = createDeferred<string>();
    shareAppointmentPrepMock.mockReturnValueOnce(shareRequest.promise);

    const { AppointmentPrepEditor } = await import('./AppointmentPrepEditor');

    render(<AppointmentPrepEditor prepId="prep-1" />);

    const shareButton = await screen.findByRole('button', { name: 'share_cta' });
    fireEvent.click(shareButton);
    fireEvent.click(shareButton);

    expect(shareAppointmentPrepMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'share_running' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'pdf_cta' })).toBeDisabled();

    shareRequest.resolve('https://example.com/share/prep-1');

    await waitFor(() => {
      expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'share_ready' });
    });

    expect(screen.getByRole('button', { name: 'share_cta' })).toBeEnabled();
  });

  it('disables pdf export while running and shows success feedback when the download starts', async () => {
    const exportRequest = createDeferred<Blob>();
    exportAppointmentPrepPdfMock.mockReturnValueOnce(exportRequest.promise);

    const { AppointmentPrepEditor } = await import('./AppointmentPrepEditor');

    render(<AppointmentPrepEditor prepId="prep-1" />);

    const exportButton = await screen.findByRole('button', { name: 'pdf_cta' });
    fireEvent.click(exportButton);
    fireEvent.click(exportButton);

    expect(exportAppointmentPrepPdfMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'pdf_running' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'share_cta' })).toBeDisabled();

    exportRequest.resolve(new Blob(['pdf'], { type: 'application/pdf' }));

    await waitFor(() => {
      expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'pdf_ready' });
    });

    expect(screen.getByRole('button', { name: 'pdf_cta' })).toBeEnabled();
  });
});
