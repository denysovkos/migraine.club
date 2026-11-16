import { describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({ hasHealthDataConsent: vi.fn(async () => true) }));

const store = {
  plans: [] as Array<{ id: string; name: string }>,
  intake: [] as Array<{ planId: string; localDate: string; state: string }>,
};

const planId = '00000000-0000-0000-0000-000000000001';

vi.mock('@/services/preventives/PreventivePlansService', () => ({
  preventivePlansService: {
    createPlan: async (_userId: string, input: any) => {
      const id = planId;
      store.plans = [{ id, name: input.name }];
      return { id };
    },
    getDuePlans: async () => ({
      timezone: 'Europe/Berlin',
      todayLocalDate: '2025-01-01',
      hasActivePlans: store.plans.length > 0,
      due: store.plans.map(p => ({
        id: p.id,
        name: p.name,
        kind: 'oral',
        scheduleLabel: 'Daily',
        isOverdue: false,
        state: store.intake.find(i => i.planId === p.id)?.state ?? null,
      })),
      notDue: [],
    }),
    upsertIntake: async (_userId: string, input: any) => {
      store.intake = store.intake.filter(i => i.planId !== input.planId);
      store.intake.push({ planId: input.planId, localDate: input.localDate, state: input.state });
    },
    getPlanSummary: async () => ({
      timezone: 'Europe/Berlin',
      plan: {
        id: store.plans[0]?.id ?? planId,
        name: store.plans[0]?.name ?? 'Test',
        kind: 'oral',
        doseText: null,
        scheduleLabel: 'Daily',
        scheduleType: 'daily',
        schedulePayload: null,
        startDate: '2025-01-01',
        status: 'active',
      },
      baseline: {
        from: '2024-12-04',
        to: '2024-12-31',
        mmd: 6,
        mhd: 10,
        acuteMedicationDays: 4,
        coverage: { totalDays: 28, recordedDays: 28, missingDays: 0 },
      },
      evaluation: {
        from: '2025-01-15',
        to: '2025-02-11',
        mmd: 3,
        mhd: 6,
        acuteMedicationDays: 2,
        coverage: { totalDays: 28, recordedDays: 28, missingDays: 0 },
        percentChangeMmd: -0.5,
        responder50: 'YES',
        missingDaysNeeded: 0,
      },
      evaluationLong: null,
      adherence: {
        last7: { dueDays: 7, taken: 6, missed: 1, unsure: 0, coverage: 1 },
        last28: { dueDays: 28, taken: 24, missed: 4, unsure: 0, coverage: 1 },
      },
      timelineWeeks: [],
    }),
    getRecentInsight: async () => null,
  },
}));

describe('Preventives API flow', () => {
  it('creates plan, gets due, logs intake, fetches summary', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });

    const createMod = await import('./route');
    const createRes = await createMod.POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Topiramate',
        kind: 'oral',
        scheduleType: 'daily',
        schedulePayload: null,
        startDate: '2025-01-01',
      }),
    }));

    expect(createRes.status).toBe(201);

    const dueMod = await import('./due/route');
    const dueRes = await dueMod.GET(new Request('http://localhost/api/preventives/due'));
    const dueJson = await dueRes.json();

    expect(dueJson.due.length).toBe(1);

    const intakeMod = await import('./intake/route');
    const intakeRes = await intakeMod.POST(new Request('http://localhost/api/preventives/intake', {
      method: 'POST',
      body: JSON.stringify({
        planId: dueJson.due[0].id,
        localDate: '2025-01-01',
        state: 'taken',
      }),
    }));

    expect(intakeRes.status).toBe(200);

    const summaryMod = await import('./[id]/summary/route');
    const summaryRes = await summaryMod.GET(new Request(`http://localhost/api/preventives/${planId}/summary`), {
      params: Promise.resolve({ id: planId }),
    });

    expect(summaryRes.status).toBe(200);
  });
});
