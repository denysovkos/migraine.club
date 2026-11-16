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

describe('/api/appointment-preps', () => {
  it('returns drafts for an authenticated user with consent', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    appointmentPrepServiceMock.listDrafts.mockResolvedValue([
      {
        id: 'draft-1',
        appointmentDate: '2026-04-15',
        visitLabel: 'Neurology',
        clinicianName: 'Dr. Rivera',
        visitReason: 'Follow-up',
        topConcerns: ['attacks'],
        doctorQuestions: ['What now?'],
        personalNotes: null,
        compareWindowDays: 90,
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);

    const mod = await import('./route');
    const res = await mod.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.drafts).toHaveLength(1);
    expect(appointmentPrepServiceMock.listDrafts).toHaveBeenCalledWith('user-1');
  });

  it('creates a draft from validated request data', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    appointmentPrepServiceMock.createDraft.mockResolvedValue({ id: 'draft-1' });

    const mod = await import('./route');
    const res = await mod.POST(
      new Request('http://localhost/api/appointment-preps', {
        method: 'POST',
        body: JSON.stringify({
          appointmentDate: '2026-04-15',
          visitLabel: '  Neurology follow-up  ',
          clinicianName: 'Dr. Rivera',
          visitReason: 'Review control',
          topConcerns: ['frequent attacks'],
          doctorQuestions: ['What should we change?'],
          personalNotes: 'Bring tracker notes.',
          compareWindowDays: '120',
          generatedSnapshot: { should: 'be stripped' },
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('draft-1');
    expect(appointmentPrepServiceMock.createDraft).toHaveBeenCalledWith('user-1', {
      appointmentDate: '2026-04-15',
      visitLabel: 'Neurology follow-up',
      clinicianName: 'Dr. Rivera',
      visitReason: 'Review control',
      topConcerns: ['frequent attacks'],
      doctorQuestions: ['What should we change?'],
      personalNotes: 'Bring tracker notes.',
      compareWindowDays: 120,
    });
  });
});
