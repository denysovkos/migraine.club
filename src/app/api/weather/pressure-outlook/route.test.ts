import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getSettingsMock, getOutlookMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getOutlookMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/pressure/PressureForecastService', () => ({
  pressureForecastService: { getSettings: getSettingsMock, getOutlookForSettings: getOutlookMock },
}));

const { GET } = await import('./route');

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'u1' });
  getSettingsMock.mockReset();
  getOutlookMock.mockReset();
});

describe('GET /api/weather/pressure-outlook', () => {
  it('rejects anonymous requests', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await GET()).status).toBe(401);
  });

  it('returns 404 SETTINGS_NOT_FOUND without a location', async () => {
    getSettingsMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'SETTINGS_NOT_FOUND' });
  });

  it('returns the outlook built from the caller\'s own settings', async () => {
    const settings = { userId: 'u1', lat: 1, lon: 2, timezone: 'UTC', pressureDropThresholdHpa: 5 };
    const outlook = { timezone: 'UTC', alertThresholdHpa: 5, highlightThresholdHpa: 5, days: [] };
    getSettingsMock.mockResolvedValue(settings);
    getOutlookMock.mockResolvedValue(outlook);

    const res = await GET();

    await expect(res.json()).resolves.toEqual(outlook);
    expect(getSettingsMock).toHaveBeenCalledWith('u1');
    expect(getOutlookMock).toHaveBeenCalledWith(settings);
  });

  it('returns 500 when the outlook cannot be built', async () => {
    getSettingsMock.mockResolvedValue({ userId: 'u1' });
    getOutlookMock.mockRejectedValue(new Error('db down'));

    expect((await GET()).status).toBe(500);
  });
});
