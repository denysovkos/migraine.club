import { describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const hasHealthDataConsentMock = vi.fn();
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({
  hasHealthDataConsent: hasHealthDataConsentMock,
}));

const appointmentPrepServiceMock = {
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
};

vi.mock('@/services/appointmentPrep/AppointmentPrepService', () => ({
  appointmentPrepService: appointmentPrepServiceMock,
}));

describe('/api/appointment-preps/:id', () => {
  it('returns a draft for an authenticated user with consent', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    appointmentPrepServiceMock.getDraft.mockResolvedValue({
      id: 'draft-1',
      appointmentDate: '2026-04-15',
      visitLabel: 'Neurology',
      clinicianName: 'Dr. Rivera',
      visitReason: 'Follow-up',
      topConcerns: ['attacks'],
      doctorQuestions: ['What now?'],
      personalNotes: null,
      compareWindowDays: 90,
      generatedSnapshot: {
        compareWindowDays: 90,
        coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
        attackStats: { totalAttacks: 2, avgIntensity: 5 },
        currentSnapshot: {
          headacheBurden: { migraineDays: 6, headacheDays: 10 },
          acuteMedicationDays: 4,
          preventiveNames: ['Topiramate'],
          questionnaireScores: { hit6: 61, midas: 18 },
        },
        whatChangedKeys: ['coverage_summary'],
        questionPromptKeys: ['treatment_adjustment'],
      },
      createdAt: '2026-04-01T12:00:00.000Z',
      updatedAt: '2026-04-01T12:00:00.000Z',
    });

    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost/api/appointment-preps/draft-1'), {
      params: Promise.resolve({ id: 'draft-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.draft.id).toBe('draft-1');
    expect(appointmentPrepServiceMock.getDraft).toHaveBeenCalledWith('user-1', 'draft-1');
  });

  it('updates only patient-authored fields', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    appointmentPrepServiceMock.updateDraft.mockResolvedValue({
      id: 'draft-1',
      appointmentDate: '2026-04-16',
      visitLabel: 'Neurology follow-up',
      clinicianName: 'Dr. Rivera',
      visitReason: 'Review control',
      topConcerns: ['frequent attacks'],
      doctorQuestions: ['What should we change?'],
      personalNotes: 'Bring tracker notes.',
      compareWindowDays: 120,
      generatedSnapshot: {
        compareWindowDays: 120,
        coverage: { totalDays: 120, recordedDays: 100, missingDays: 20 },
        attackStats: { totalAttacks: 3, avgIntensity: 5 },
        currentSnapshot: {
          headacheBurden: { migraineDays: 8, headacheDays: 14 },
          acuteMedicationDays: 6,
          preventiveNames: ['Topiramate'],
          questionnaireScores: { hit6: 61, midas: 18 },
        },
        whatChangedKeys: [],
        questionPromptKeys: [],
      },
      createdAt: '2026-04-01T12:00:00.000Z',
      updatedAt: '2026-04-02T12:00:00.000Z',
    });

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/appointment-preps/draft-1', {
        method: 'PATCH',
        body: JSON.stringify({
          appointmentDate: '2026-04-16',
          visitLabel: 'Neurology follow-up',
          clinicianName: 'Dr. Rivera',
          visitReason: 'Review control',
          topConcerns: ['frequent attacks'],
          doctorQuestions: ['What should we change?'],
          personalNotes: 'Bring tracker notes.',
          generatedSnapshot: { should: 'be ignored' },
        }),
      }),
      { params: Promise.resolve({ id: 'draft-1' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.draft.id).toBe('draft-1');
    expect(appointmentPrepServiceMock.updateDraft).toHaveBeenCalledWith('user-1', 'draft-1', {
      appointmentDate: '2026-04-16',
      visitLabel: 'Neurology follow-up',
      clinicianName: 'Dr. Rivera',
      visitReason: 'Review control',
      topConcerns: ['frequent attacks'],
      doctorQuestions: ['What should we change?'],
      personalNotes: 'Bring tracker notes.',
    });
  });

  it('deletes a draft', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    appointmentPrepServiceMock.deleteDraft.mockResolvedValue(undefined);

    const mod = await import('./route');
    const res = await mod.DELETE(new Request('http://localhost/api/appointment-preps/draft-1'), {
      params: Promise.resolve({ id: 'draft-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(appointmentPrepServiceMock.deleteDraft).toHaveBeenCalledWith('user-1', 'draft-1');
  });
});
