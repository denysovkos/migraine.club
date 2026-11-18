import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, env } = vi.hoisted(() => ({
  getMock: vi.fn(),
  env: { OPENWEATHERMAP_API_KEY: 'key' as string | undefined },
}));

vi.mock('axios', () => ({ default: { create: () => ({ get: getMock }) } }));
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { OpenWeatherMapRepository } = await import('./OpenWeatherMapRepository');

beforeEach(() => {
  getMock.mockReset();
  env.OPENWEATHERMAP_API_KEY = 'key';
});

describe('OpenWeatherMapRepository.getDailyPressureForecast', () => {
  it('maps the OneCall daily series to pressure points', async () => {
    getMock.mockResolvedValue({
      data: {
        daily: [
          { dt: 100, pressure: 1012 },
          { dt: 200, pressure: 1004 },
          { dt: 300 }, // malformed entries are dropped
        ],
      },
    });

    const points = await new OpenWeatherMapRepository().getDailyPressureForecast(52.52, 13.4);

    expect(points).toEqual([{ dt: 100, pressureHpa: 1012 }, { dt: 200, pressureHpa: 1004 }]);
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('onecall'), {
      params: expect.objectContaining({ lat: 52.52, lon: 13.4, exclude: 'current,minutely,hourly,alerts' }),
    });
  });

  it('returns [] when the request fails', async () => {
    getMock.mockRejectedValue(new Error('timeout'));

    await expect(new OpenWeatherMapRepository().getDailyPressureForecast(1, 2)).resolves.toEqual([]);
  });

  it('returns [] without calling out when no API key is configured', async () => {
    env.OPENWEATHERMAP_API_KEY = undefined;

    await expect(new OpenWeatherMapRepository().getDailyPressureForecast(1, 2)).resolves.toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });
});
