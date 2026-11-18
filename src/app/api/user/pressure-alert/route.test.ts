import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getSettingsMock, setThresholdMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSettingsMock: vi.fn(),
  setThresholdMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/pressure/PressureForecastService', () => ({
  pressureForecastService: { getSettings: getSettingsMock, setThreshold: setThresholdMock },
}));

const { GET, PUT } = await import('./route');

function put(body: unknown) {
  return PUT(new Request('http://localhost/api/user/pressure-alert', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'u1' });
  getSettingsMock.mockReset();
  setThresholdMock.mockReset();
});

describe('GET /api/user/pressure-alert', () => {
  it('rejects anonymous requests', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await GET()).status).toBe(401);
  });

  it('returns the caller\'s threshold', async () => {
    getSettingsMock.mockResolvedValue({ pressureDropThresholdHpa: 8 });

    const res = await GET();

    await expect(res.json()).resolves.toEqual({ hasLocation: true, thresholdHpa: 8 });
    expect(getSettingsMock).toHaveBeenCalledWith('u1');
  });

  it('reports no location when settings are missing', async () => {
    getSettingsMock.mockResolvedValue(null);

    await expect((await GET()).json()).resolves.toEqual({ hasLocation: false, thresholdHpa: null });
  });
});

describe('PUT /api/user/pressure-alert', () => {
  it('rejects anonymous requests', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await put({ thresholdHpa: 5 })).status).toBe(401);
    expect(setThresholdMock).not.toHaveBeenCalled();
  });

  it('saves a threshold for the caller only', async () => {
    setThresholdMock.mockResolvedValue(true);

    const res = await put({ thresholdHpa: 5 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ hasLocation: true, thresholdHpa: 5 });
    expect(setThresholdMock).toHaveBeenCalledWith('u1', 5);
  });

  it('turns alerts off with null', async () => {
    setThresholdMock.mockResolvedValue(true);

    expect((await put({ thresholdHpa: null })).status).toBe(200);
    expect(setThresholdMock).toHaveBeenCalledWith('u1', null);
  });

  it.each([
    [{ thresholdHpa: 0 }],
    [{ thresholdHpa: 31 }],
    [{ thresholdHpa: '5' }],
    [{}],
    ['not json'],
  ])('rejects invalid body %j', async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(setThresholdMock).not.toHaveBeenCalled();
  });

  it('asks for a location first when none is saved', async () => {
    setThresholdMock.mockResolvedValue(false);

    const res = await put({ thresholdHpa: 5 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'SETTINGS_NOT_FOUND' });
  });
});
