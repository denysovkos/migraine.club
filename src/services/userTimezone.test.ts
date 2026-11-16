import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectReturns: any[][] = [];

vi.mock('@/libs/DB', () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => selectReturns.shift() ?? []),
          })),
        })),
      })),
    },
  };
});

describe('getUserTimezone', () => {
  beforeEach(() => {
    selectReturns.length = 0;
    vi.resetModules();
  });

  it('prefers user_outcome_settings.timezone when present', async () => {
    selectReturns.push([{ tz1: 'Europe/Berlin' }]);

    const { getUserTimezone } = await import('@/services/userTimezone');

    await expect(getUserTimezone('user_1')).resolves.toBe('Europe/Berlin');
  });

  it('falls back to user_weather_settings.timezone', async () => {
    selectReturns.push([{ tz1: null }]);
    selectReturns.push([{ tz2: 'America/New_York' }]);

    const { getUserTimezone } = await import('@/services/userTimezone');

    await expect(getUserTimezone('user_1')).resolves.toBe('America/New_York');
  });

  it('falls back to UTC when no settings exist', async () => {
    selectReturns.push([]);
    selectReturns.push([]);

    const { getUserTimezone } = await import('@/services/userTimezone');

    await expect(getUserTimezone('user_1')).resolves.toBe('UTC');
  });
});
