import { describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({ hasHealthDataConsent: vi.fn(async () => true) }));

const store = {
  medications: [{ id: '00000000-0000-0000-0000-000000000111', userId: 'user-1', isAcute: true }],
  episodes: [] as Array<{ id: number; userId: string; isOngoing: boolean; startTime: Date }>,
  doses: [] as Array<{ id: string; userId: string; medicationId: string; attackId: number | null; takenAt: Date }>,
  outcomes: [] as Array<{ id: string; doseId: string; helped: 'yes' | 'partly' | 'no' }>,
};

vi.mock('@/libs/DB', () => {
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () => {
            const tableName = table?.[Symbol.for('drizzle:Name')] ?? table?._.name;
            if (String(tableName).includes('user_medications')) {
              return [{ id: store.medications[0]!.id, isAcute: true }];
            }
            if (String(tableName).includes('episode')) {
              return store.episodes.slice(0, 1).map(e => ({ id: e.id }));
            }
            if (String(tableName).includes('acute_doses')) {
              return store.doses.slice(0, 1).map(d => ({ id: d.id }));
            }
            return [];
          },
          orderBy: () => ({
            limit: async () => store.episodes.slice(0, 1).map(e => ({ id: e.id })),
          }),
        }),
        orderBy: () => ({
          limit: async () => store.episodes.slice(0, 1).map(e => ({ id: e.id })),
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        const tableName = table?.[Symbol.for('drizzle:Name')] ?? table?._.name;
        if (String(tableName).includes('episode')) {
          const id = store.episodes.length + 1;
          store.episodes.push({ id, userId: values.userId, isOngoing: true, startTime: new Date() });
          return {
            returning: async () => [{ id }],
          };
        }
        if (String(tableName).includes('acute_doses')) {
          const id = `00000000-0000-0000-0000-${String(store.doses.length + 1).padStart(12, '0')}`;
          store.doses.push({
            id,
            userId: values.userId,
            medicationId: values.medicationId,
            attackId: values.attackId ?? null,
            takenAt: values.takenAt ?? new Date(),
          });
          return {
            returning: async () => [{ id }],
          };
        }
        if (String(tableName).includes('dose_outcomes')) {
          const existing = store.outcomes.find(o => o.doseId === values.doseId);
          if (existing) {
            existing.helped = values.helped;
          } else {
            store.outcomes.push({
              id: `00000000-0000-0000-0000-${String(store.outcomes.length + 1).padStart(12, '0')}`,
              doseId: values.doseId,
              helped: values.helped,
            });
          }
          return {
            onConflictDoUpdate: () => ({
              returning: async () => [{ id: store.outcomes.find(o => o.doseId === values.doseId)!.id }],
            }),
          };
        }
        return { returning: async () => [] };
      },
    }),
  };
  return { db };
});

vi.mock('@/services/acuteMedications/moh', () => ({
  getMOHStatus: vi.fn(async () => ({
    status: 'approaching',
    perClass: [
      {
        medicationClass: 'triptan',
        rolling30DaysUsed: 8,
        threshold: 10,
        status: 'approaching',
      },
    ],
    message: 'Acute medication use may increase risk of medication-overuse headache; discuss with your clinician.',
  })),
}));

describe('acute medication endpoints flow', () => {
  it('logs dose, upserts outcome, returns moh status', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });

    const acuteDosesRoute = await import('./acute-doses/route');
    const createRes = await acuteDosesRoute.POST(new Request('http://localhost/api/acute-doses', {
      method: 'POST',
      body: JSON.stringify({
        medicationId: store.medications[0]!.id,
        createAttackIfMissing: false,
      }),
    }));

    expect(createRes.status).toBe(201);

    const createJson = await createRes.json();

    const outcomesRoute = await import('./dose-outcomes/route');
    const outcomeRes = await outcomesRoute.POST(new Request('http://localhost/api/dose-outcomes', {
      method: 'POST',
      body: JSON.stringify({
        doseId: createJson.doseId,
        helped: 'yes',
      }),
    }));

    expect(outcomeRes.status).toBe(200);

    const mohRoute = await import('./moh-status/route');
    const mohRes = await mohRoute.GET(new Request('http://localhost/api/moh-status'));
    const mohJson = await mohRes.json();

    expect(mohRes.status).toBe(200);
    expect(mohJson.status).toBe('approaching');
  });
});
