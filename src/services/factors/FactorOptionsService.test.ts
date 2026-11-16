import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/factors/options/route';

import { buildRecentFactors, factorOptionsService, mergeFactorOptions } from './FactorOptionsService';

const { authMock, hasHealthDataConsentMock, getOptionsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  hasHealthDataConsentMock: vi.fn(),
  getOptionsMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({
  hasHealthDataConsent: hasHealthDataConsentMock,
}));

beforeEach(() => {
  authMock.mockReset();
  hasHealthDataConsentMock.mockReset();
  getOptionsMock.mockReset();
  vi.restoreAllMocks();
});

describe('mergeFactorOptions', () => {
  it('returns built-ins plus recent custom factors without duplicate keys', () => {
    const result = mergeFactorOptions({
      builtIns: [
        { key: 'stress', type: 'trigger', translationKey: 'builtins.trigger.stress' },
      ],
      recent: [
        { key: null, displayName: 'Bright lights', type: 'trigger', factorId: 'factor-1' },
      ],
      logged: new Set(['trigger:stress']),
    });

    expect(result.trigger.builtIns[0]).toMatchObject({ key: 'stress', logged: true });
    expect(result.trigger.recent[0]).toMatchObject({ displayName: 'Bright lights', factorId: 'factor-1' });
  });
});

describe('buildRecentFactors', () => {
  it('dedupes repeated events for the same factor and preserves recency order', () => {
    const result = buildRecentFactors([
      {
        factorId: 'factor-1',
        displayName: 'Bright lights',
        type: 'trigger',
        key: null,
        lastOccurredAt: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        factorId: 'factor-1',
        displayName: 'Bright lights',
        type: 'trigger',
        key: null,
        lastOccurredAt: new Date('2026-04-04T09:00:00.000Z'),
      },
      {
        factorId: 'factor-2',
        displayName: 'Long walk',
        type: 'protector',
        key: null,
        lastOccurredAt: new Date('2026-04-04T08:00:00.000Z'),
      },
    ]);

    expect(result).toEqual([
      { factorId: 'factor-1', displayName: 'Bright lights', type: 'trigger', key: null },
      { factorId: 'factor-2', displayName: 'Long walk', type: 'protector', key: null },
    ]);
  });
});

describe('GET /api/factors/options', () => {
  it('rejects invalid localDate with 400', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(true);
    vi.spyOn(factorOptionsService, 'getOptions').mockImplementation(getOptionsMock);

    const response = await GET(new Request('http://localhost/api/factors/options?localDate=2026-02-31'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid localDate' });
    expect(getOptionsMock).not.toHaveBeenCalled();
  });
});
