import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state, getOutlookMock, sendToUserMock } = vi.hoisted(() => {
  const state = {
    users: [] as unknown[],
    insertReturning: [] as unknown[],
    inserted: [] as unknown[],
    updates: [] as unknown[],
  };
  const dbMock = {
    select: vi.fn(() => {
      const chain: any = {
        from: () => chain,
        innerJoin: () => chain,
        where: async () => state.users,
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        state.inserted.push(v);
        return { onConflictDoNothing: () => ({ returning: async () => state.insertReturning }) };
      },
    })),
    update: vi.fn(() => ({
      set: (s: unknown) => {
        state.updates.push(s);
        return { where: async () => undefined };
      },
    })),
  };
  return { dbMock, state, getOutlookMock: vi.fn(), sendToUserMock: vi.fn() };
});

vi.mock('@/libs/DB', () => ({ db: dbMock }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/server/push/push.service', () => ({ pushService: { sendToUser: sendToUserMock } }));
vi.mock('@/libs/i18nMessages', () => ({
  getServerTranslator: async () => (key: string, vals?: Record<string, string>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}));
vi.mock('./PressureForecastService', () => ({
  pressureForecastService: { getOutlookForSettings: getOutlookMock },
}));
vi.mock('@/services/DailyRiskAlertService', () => ({
  isNotBetween8pmAnd9am: (dt: DateTime) => dt.hour >= 9 && dt.hour < 20,
}));

const { PressureAlertService } = await import('./PressureAlertService');

const USER = {
  userId: 'u1',
  lat: 52.52,
  lon: 13.4,
  timezone: 'Europe/Berlin',
  pressureDropThresholdHpa: 5,
  preferredLanguage: 'en' as const,
};

// 11:00 local in Berlin
const NOW = new Date('2026-11-18T10:00:00Z');

function outlookWith(days: Array<[string, number | null, boolean]>) {
  return {
    timezone: 'Europe/Berlin',
    alertThresholdHpa: 5,
    highlightThresholdHpa: 5,
    days: days.map(([date, changeHpa, drop]) => ({ date, pressureHpa: 1010, changeHpa, dropAtOrAboveThreshold: drop })),
  };
}

beforeEach(() => {
  state.users = [];
  state.insertReturning = [{ id: 'run' }];
  state.inserted = [];
  state.updates = [];
  getOutlookMock.mockReset();
  sendToUserMock.mockReset();
});

describe('PressureAlertService.processUser', () => {
  const service = new PressureAlertService();

  it('sends one push for tomorrow\'s drop and records it under the drop date', async () => {
    getOutlookMock.mockResolvedValue(outlookWith([
      ['2026-11-18', null, false],
      ['2026-11-19', -6.2, true],
    ]));

    const result = await service.processUser(USER, NOW);

    expect(result).toEqual({ userId: 'u1', status: 'sent', dropDate: '2026-11-19', dropHpa: 6.2 });
    expect(state.inserted).toEqual([expect.objectContaining({ userId: 'u1', localDate: '2026-11-19', type: 'pressure_drop' })]);
    expect(state.updates).toEqual([expect.objectContaining({ status: 'sent', details: expect.objectContaining({ dropHpa: 6.2, thresholdHpa: 5 }) })]);
    expect(sendToUserMock).toHaveBeenCalledWith('u1', expect.objectContaining({
      title: 'pressureDrop.title',
      body: 'pressureDrop.body:{"drop":"6.2","day":"pressureDrop.tomorrow"}',
      tag: 'pressure-drop-alert',
    }));
  });

  it('names the weekday when the drop is two days out', async () => {
    getOutlookMock.mockResolvedValue(outlookWith([
      ['2026-11-18', null, false],
      ['2026-11-19', -1, false],
      ['2026-11-20', -8, true],
    ]));

    await service.processUser(USER, NOW);

    expect(sendToUserMock.mock.calls[0]![1].body).toContain('pressureDrop.onDay:{\\"weekday\\":\\"Friday\\"}');
  });

  it('skips when no day in the horizon meets the threshold', async () => {
    getOutlookMock.mockResolvedValue(outlookWith([
      ['2026-11-18', -9, true], // today's fall is not "ahead"
      ['2026-11-19', -2, false],
      ['2026-11-20', 3, false],
      ['2026-11-21', -12, true], // beyond the two-day horizon
    ]));

    await expect(service.processUser(USER, NOW)).resolves.toEqual({ userId: 'u1', status: 'skipped' });
    expect(state.inserted).toEqual([]);
    expect(sendToUserMock).not.toHaveBeenCalled();
  });

  it('stays quiet outside 09:00 to 19:59 local without fetching the forecast', async () => {
    const late = DateTime.fromISO('2026-11-18T21:00:00', { zone: 'Europe/Berlin' }).toJSDate();

    await expect(service.processUser(USER, late)).resolves.toEqual({ userId: 'u1', status: 'skipped' });
    expect(getOutlookMock).not.toHaveBeenCalled();
  });

  it('does not resend for a drop day already alerted', async () => {
    getOutlookMock.mockResolvedValue(outlookWith([['2026-11-18', null, false], ['2026-11-19', -6, true]]));
    state.insertReturning = [];

    await expect(service.processUser(USER, NOW)).resolves.toMatchObject({ status: 'already_processed', dropDate: '2026-11-19' });
    expect(sendToUserMock).not.toHaveBeenCalled();
  });

  it('marks the run failed when the push throws', async () => {
    getOutlookMock.mockResolvedValue(outlookWith([['2026-11-18', null, false], ['2026-11-19', -6, true]]));
    sendToUserMock.mockRejectedValue(new Error('push down'));

    await expect(service.processUser(USER, NOW)).resolves.toMatchObject({ status: 'failed', error: 'push down' });
    expect(state.updates).toEqual([expect.objectContaining({ status: 'failed', details: expect.objectContaining({ errorMessage: 'push down' }) })]);
  });
});

describe('PressureAlertService.processAlerts', () => {
  it('only processes users with a threshold and tallies results; one failure does not stop the run', async () => {
    state.users = [
      USER,
      { ...USER, userId: 'u2' },
      { ...USER, userId: 'u3', pressureDropThresholdHpa: null },
    ];
    getOutlookMock
      .mockResolvedValueOnce(outlookWith([['2026-11-18', null, false], ['2026-11-19', -6, true]]))
      .mockRejectedValueOnce(new Error('forecast down'));

    const result = await new PressureAlertService().processAlerts(NOW);

    expect(result).toMatchObject({ usersProcessed: 2, sent: 1, failed: 1, skipped: 0, alreadyProcessed: 0, truncated: false });
    expect(result.results.map(r => r.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('returns an empty summary with no opted-in users', async () => {
    await expect(new PressureAlertService().processAlerts(NOW)).resolves.toMatchObject({ usersProcessed: 0, sent: 0 });
  });
});
