import { describe, expect, it, vi } from 'vitest';

const selectResults: unknown[] = [];

function createSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => (selectResults.shift() as unknown[]) ?? []),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve((selectResults.shift() as unknown[]) ?? []).then(resolve, reject),
  };

  return chain;
}

const dbMock = {
  select: vi.fn(() => createSelectChain()),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  })),
};

vi.mock('@/libs/DB', () => ({ db: dbMock }));

const outcomesMock = {
  computeOutcomes: vi.fn(),
  computeMonthly: vi.fn(),
};

vi.mock('@/services/OutcomesService', () => ({ outcomesService: outcomesMock }));

describe('GET /api/share/[token]', () => {
  it('returns appointment prep context when the link is bound to a prep draft', async () => {
    selectResults.length = 0;
    dbMock.select.mockClear();
    outcomesMock.computeOutcomes.mockReset();
    outcomesMock.computeMonthly.mockReset();

    selectResults.push(
      [{
        id: 'link-1',
        userId: 'user-1',
        token: 'token-12345678901234567890',
        isRevoked: false,
        expiresAt: new Date('2099-05-01T00:00:00.000Z'),
        patientDisplayName: 'Patient Example',
        recipientName: 'Dr. Smith',
        dateRangeStart: null,
        dateRangeEnd: null,
        appointmentPrepId: 'prep-1',
      }],
      [{ preferredLanguage: 'en' }],
      [{
        appointmentDate: new Date('2026-05-01T00:00:00.000Z'),
        visitLabel: 'Neurology follow-up',
        clinicianName: 'Dr. Smith',
        visitReason: 'Review worsening attacks',
        topConcerns: ['More migraine days'],
        doctorQuestions: ['Should we change preventive treatment?'],
        personalNotes: 'Bring headache diary',
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
          whatChangedKeys: ['coverage_summary'],
          questionPromptKeys: ['treatment_adjustment'],
        },
      }],
      [],
      [],
      [],
    );

    outcomesMock.computeOutcomes
      .mockResolvedValueOnce({ timezone: 'UTC' })
      .mockResolvedValueOnce({ timezone: 'UTC' });
    outcomesMock.computeMonthly.mockResolvedValue({ months: [] });

    const mod = await import('./route');
    const res = await mod.GET(
      new Request('http://localhost/api/share/token-12345678901234567890'),
      { params: Promise.resolve({ token: 'token-12345678901234567890' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.appointmentPrep).toMatchObject({
      visitReason: 'Review worsening attacks',
      topConcerns: ['More migraine days'],
      doctorQuestions: ['Should we change preventive treatment?'],
    });
  });
});
