import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state, getDailyPressureForecastMock } = vi.hoisted(() => {
  const state = {
    selectRows: [] as unknown[][],
    inserted: [] as unknown[],
    conflictSet: null as unknown,
    updateSet: null as unknown,
    updateReturning: [] as unknown[],
  };
  const selectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => state.selectRows.shift() ?? [],
    };
    return chain;
  };
  const dbMock = {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        state.inserted.push(v);
        return {
          onConflictDoUpdate: async (cfg: { set: unknown }) => {
            state.conflictSet = cfg.set;
          },
        };
      },
    })),
    update: vi.fn(() => ({
      set: (s: unknown) => {
        state.updateSet = s;
        return { where: () => ({ returning: async () => state.updateReturning }) };
      },
    })),
  };
  return { dbMock, state, getDailyPressureForecastMock: vi.fn() };
});

vi.mock('@/libs/DB', () => ({ db: dbMock }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/repositories/OpenWeatherMapRepository', () => ({
  openWeatherMapRepository: { getDailyPressureForecast: getDailyPressureForecastMock },
}));

const { PressureForecastService, PRESSURE_FORECAST_TTL_MS, roundCoord } = await import('./PressureForecastService');

const NOW = new Date('2026-11-18T10:00:00Z');
const POINTS = [{ dt: 1, pressureHpa: 1010 }];
const FRESH = [{ dt: 2, pressureHpa: 1000 }];

beforeEach(() => {
  state.selectRows = [];
  state.inserted = [];
  state.conflictSet = null;
  state.updateSet = null;
  state.updateReturning = [];
  getDailyPressureForecastMock.mockReset();
  dbMock.update.mockClear();
});

describe('roundCoord', () => {
  it('rounds to two decimals', () => {
    expect(roundCoord(52.51999)).toBe(52.52);
    expect(roundCoord(-13.40501)).toBe(-13.41);
  });
});

describe('PressureForecastService.getForecastPoints', () => {
  const service = new PressureForecastService();

  it('serves a fresh cache row without calling the provider', async () => {
    state.selectRows.push([{ points: POINTS, fetchedAt: new Date(NOW.getTime() - 60_000) }]);

    await expect(service.getForecastPoints(52.52, 13.4, NOW)).resolves.toEqual(POINTS);
    expect(getDailyPressureForecastMock).not.toHaveBeenCalled();
  });

  it('refetches a stale row and upserts the result at rounded coordinates', async () => {
    state.selectRows.push([{ points: POINTS, fetchedAt: new Date(NOW.getTime() - PRESSURE_FORECAST_TTL_MS) }]);
    getDailyPressureForecastMock.mockResolvedValue(FRESH);

    await expect(service.getForecastPoints(52.5249, 13.4011, NOW)).resolves.toEqual(FRESH);
    expect(getDailyPressureForecastMock).toHaveBeenCalledWith(52.52, 13.4);
    expect(state.inserted).toEqual([{ lat: 52.52, lon: 13.4, points: FRESH, fetchedAt: NOW }]);
    expect(state.conflictSet).toEqual({ points: FRESH, fetchedAt: NOW });
  });

  it('falls back to the stale row when the provider returns nothing', async () => {
    state.selectRows.push([{ points: POINTS, fetchedAt: new Date(0) }]);
    getDailyPressureForecastMock.mockResolvedValue([]);

    await expect(service.getForecastPoints(1, 2, NOW)).resolves.toEqual(POINTS);
    expect(state.inserted).toEqual([]);
  });

  it('returns [] with no cache and no provider data', async () => {
    getDailyPressureForecastMock.mockResolvedValue([]);

    await expect(service.getForecastPoints(1, 2, NOW)).resolves.toEqual([]);
  });
});

describe('PressureForecastService.setThreshold', () => {
  const service = new PressureForecastService();

  it('writes the threshold and reports whether a settings row existed', async () => {
    state.updateReturning = [{ id: 'x' }];

    await expect(service.setThreshold('u1', 5)).resolves.toBe(true);
    expect(state.updateSet).toEqual({ pressureDropThresholdHpa: 5 });

    state.updateReturning = [];

    await expect(service.setThreshold('u1', null)).resolves.toBe(false);
    expect(state.updateSet).toEqual({ pressureDropThresholdHpa: null });
  });

  it('rejects out-of-range values before touching the DB', async () => {
    await expect(service.setThreshold('u1', 0)).rejects.toThrow(RangeError);
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe('PressureForecastService.getOutlookForSettings', () => {
  const service = new PressureForecastService();
  const noon = (iso: string) => new Date(`${iso}T11:00:00Z`).getTime() / 1000;

  it('uses the user threshold, or the default for highlighting when alerts are off', async () => {
    const points = [
      { dt: noon('2026-11-18'), pressureHpa: 1015 },
      { dt: noon('2026-11-19'), pressureHpa: 1011 },
    ];
    state.selectRows.push([{ points, fetchedAt: NOW }], [{ points, fetchedAt: NOW }]);
    const base = { userId: 'u1', lat: 1, lon: 2, timezone: 'Europe/Berlin' };

    const withAlert = await service.getOutlookForSettings({ ...base, pressureDropThresholdHpa: 3 }, NOW);

    expect(withAlert).toMatchObject({ alertThresholdHpa: 3, highlightThresholdHpa: 3, timezone: 'Europe/Berlin' });
    expect(withAlert.days[1]).toMatchObject({ date: '2026-11-19', changeHpa: -4, dropAtOrAboveThreshold: true });

    const off = await service.getOutlookForSettings({ ...base, pressureDropThresholdHpa: null }, NOW);

    expect(off).toMatchObject({ alertThresholdHpa: null, highlightThresholdHpa: 5 });
    expect(off.days[1]!.dropAtOrAboveThreshold).toBe(false);
  });
});
