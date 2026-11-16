import { Buffer } from 'node:buffer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const getModelMock = vi.fn();
vi.mock('@/services/reports/clinician/model', () => ({
  getClinicianReportModel: getModelMock,
}));

const renderPdfMock = vi.fn();
vi.mock('@/services/reports/clinician/renderPdfBuffer', () => ({
  renderClinicianReportPdf: renderPdfMock,
}));

describe('POST /api/reports/clinician/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes appointmentPrepId through to the clinician report model', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-03-31' },
    });
    renderPdfMock.mockResolvedValue(Buffer.from(`%PDF-1.7
Migrennity Clinician Report
${'x'.repeat(2000)}`));

    const mod = await import('./route');
    await mod.POST(new Request('http://localhost/api/reports/clinician/pdf', {
      method: 'POST',
      body: JSON.stringify({ template: 'quick', appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000' }),
    }));

    expect(getModelMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
      appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000',
    }));
  });

  it('returns non-empty PDF bytes with correct content-type', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-03-31' },
    });
    renderPdfMock.mockResolvedValue(Buffer.from(`%PDF-1.7
Migrennity Clinician Report
${'x'.repeat(2000)}`));

    const mod = await import('./route');
    const res = await mod.POST(new Request('http://localhost/api/reports/clinician/pdf', {
      method: 'POST',
      body: JSON.stringify({ template: 'quick' }),
    }));
    const bytes = Buffer.from(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(bytes.length).toBeGreaterThan(1200);
    expect(bytes.toString('utf-8')).toContain('Migrennity Clinician Report');
  });

  it('returns a PDF for appointment-prep report generation', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      range: { from: '2026-03-01', to: '2026-04-05' },
      appointmentPrep: {
        appointmentDate: '2026-04-12',
        visitLabel: 'Next Appointment Prep',
        clinicianName: 'Dr. Rivera',
        visitReason: 'Worsening migraine frequency and new visual symptoms',
        topConcerns: ['More migraine days'],
        doctorQuestions: ['Should we change preventives?'],
        personalNotes: 'Bring the medication list.',
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
            preventiveNames: ['Topiramate'],
            questionnaireScores: {
              hit6: 66,
              midas: 18,
            },
          },
          whatChangedKeys: ['more_frequent_attacks'],
          questionPromptKeys: ['treatment_adjustment'],
        },
      },
    });
    renderPdfMock.mockResolvedValue(Buffer.from(`%PDF-1.7
Migrennity Clinician Report
${'x'.repeat(2000)}`));

    const mod = await import('./route');
    const res = await mod.POST(new Request('http://localhost/api/reports/clinician/pdf', {
      method: 'POST',
      body: JSON.stringify({ template: 'quick', appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000' }),
    }));
    const bytes = Buffer.from(await res.arrayBuffer());

    expect(getModelMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
      appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000',
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('Migrennity_Appointment_Prep_');
    expect(bytes.toString('utf-8')).toContain('Migrennity Clinician Report');
  });

  it('prevents blank pdf responses', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-03-31' },
    });
    renderPdfMock.mockResolvedValue(Buffer.from('%PDF-1.7 tiny'));

    const mod = await import('./route');
    const res = await mod.POST(new Request('http://localhost/api/reports/clinician/pdf', {
      method: 'POST',
      body: JSON.stringify({ template: 'quick' }),
    }));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'PDF_GENERATION_EMPTY' });
  });
});
