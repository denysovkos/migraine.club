import type { FactorTypeType } from '@/models/Schema';

import { describe, expect, it } from 'vitest';

import { computeInsightsForUser, DEFAULT_INSIGHTS_ENGINE_CONFIG } from './InsightsEngine';

function d(iso: string): Date {
  return new Date(iso);
}

describe('computeInsightsForUser', () => {
  const baseCfg = {
    ...DEFAULT_INSIGHTS_ENGINE_CONFIG,
    windowDays: 30,
    minDiaryDays: 1,
    minAttackStarts: 1,
    minCaseMoments: 1,
    minTotalExposures: 1,
    controlsPerCase: 1,
  };

  const diaryForDays = (startIso: string, days: number): Array<{ localDate: string }> => {
    const out: Array<{ localDate: string }> = [];
    const start = d(startIso);
    for (let i = 0; i < days; i++) {
      out.push({ localDate: new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) });
    }
    return out;
  };

  it('produces a conservative insight when the association is strong in-window', () => {
    const userId = 'user_1';
    const nowUtc = d('2025-01-01T12:00:00Z');

    const cfg = {
      ...DEFAULT_INSIGHTS_ENGINE_CONFIG,
      windowDays: 60,
      controlsPerCase: 4,
    };

    const stressId = 'factor_stress';
    const otherId = 'factor_other';
    const factors: Array<{ id: string; displayName: string; type: FactorTypeType }> = [
      { id: stressId, displayName: 'Stress', type: 'trigger' },
      { id: otherId, displayName: 'Other coverage', type: 'protector' },
    ];

    // 6 episodes (>= minAttackStarts)
    const episodes = [
      { id: 1, startTime: d('2024-11-10T10:00:00Z'), endTime: d('2024-11-10T12:00:00Z'), isOngoing: false },
      { id: 2, startTime: d('2024-11-17T10:00:00Z'), endTime: d('2024-11-17T12:00:00Z'), isOngoing: false },
      { id: 3, startTime: d('2024-11-24T10:00:00Z'), endTime: d('2024-11-24T12:00:00Z'), isOngoing: false },
      { id: 4, startTime: d('2024-12-01T10:00:00Z'), endTime: d('2024-12-01T12:00:00Z'), isOngoing: false },
      { id: 5, startTime: d('2024-12-08T10:00:00Z'), endTime: d('2024-12-08T12:00:00Z'), isOngoing: false },
      { id: 6, startTime: d('2024-12-15T10:00:00Z'), endTime: d('2024-12-15T12:00:00Z'), isOngoing: false },
    ];

    const factorEvents: Array<{ factorId: string; occurredAt: Date }> = [];

    // Create diary coverage for every day in the 60-day window
    const diaryEntries: Array<{ localDate: string }> = [];
    for (let i = 0; i < 60; i++) {
      const day = new Date(nowUtc.getTime() - i * 24 * 60 * 60 * 1000);
      diaryEntries.push({ localDate: day.toISOString().slice(0, 10) });
    }

    // For each episode: log Stress in the 0–24h window before onset (strong association)
    for (const ep of episodes) {
      factorEvents.push({
        factorId: stressId,
        occurredAt: new Date(ep.startTime.getTime() - 3 * 60 * 60 * 1000), // 3h before onset
      });
    }

    const res = computeInsightsForUser({
      userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents,
      diaryEntries,
      timezone: 'UTC',
    });

    expect(res.payload.methodVersion).toBe(cfg.methodVersion);

    const all = res.payload.buckets.flatMap(b => b.items);

    expect(all.length).toBeGreaterThan(0);

    const top = all.find(c => c.factorId === stressId);

    expect(top).toBeTruthy();
    expect(top!.window).toBe('0_12h');
    expect(top!.riskDiff).toBeGreaterThan(0);
  });

  it('excludes control moments within attack windows', () => {
    const userId = 'user_controls';
    const nowUtc = d('2025-01-10T12:00:00Z');
    const cfg = { ...baseCfg, controlGuardHours: 48 };
    const episodes = [
      { id: 1, startTime: d('2025-01-05T10:00:00Z'), endTime: d('2025-01-07T10:00:00Z'), isOngoing: false },
    ];
    const factors = [{ id: 'f', displayName: 'Stress', type: 'trigger' as const }];
    const factorEvents = [{ factorId: 'f', occurredAt: d('2025-01-05T08:00:00Z') }];
    const diaryEntries = diaryForDays('2025-01-05T00:00:00Z', 3);

    const res = computeInsightsForUser({
      userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents,
      diaryEntries,
      timezone: 'UTC',
    });

    expect(res.status).toBe('insufficient_data');
  });

  it('uses correct exposure windows', () => {
    const userId = 'user_windows';
    const nowUtc = d('2025-01-10T12:00:00Z');
    const cfg = { ...baseCfg, alpha: 1 };
    const episodes = [
      { id: 1, startTime: d('2025-01-09T12:00:00Z'), endTime: d('2025-01-09T13:00:00Z'), isOngoing: false },
    ];
    const factors = [{ id: 'f', displayName: 'Caffeine', type: 'trigger' as const }];
    const factorEvents = [
      { factorId: 'f', occurredAt: d('2025-01-08T22:30:00Z') }, // ~13.5h before onset => 12-24h window
    ];
    const diaryEntries = diaryForDays('2025-01-01T00:00:00Z', 10);

    const res = computeInsightsForUser({
      userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents,
      diaryEntries,
      timezone: 'UTC',
    });

    const all = res.payload.buckets.flatMap(b => b.items);

    expect(all.some(c => c.window === '12_24h')).toBe(true);
  });

  it('treats missing diary coverage as unknown', () => {
    const userId = 'user_missing';
    const nowUtc = d('2025-01-10T12:00:00Z');
    const cfg = { ...baseCfg };
    const episodes = [
      { id: 1, startTime: d('2025-01-09T12:00:00Z'), endTime: d('2025-01-09T13:00:00Z'), isOngoing: false },
    ];
    const factors = [{ id: 'f', displayName: 'Alcohol', type: 'trigger' as const }];
    const factorEvents = [{ factorId: 'f', occurredAt: d('2025-01-08T08:00:00Z') }];
    const diaryEntries = [{ localDate: '2025-01-09' }]; // missing prior day => exposure window not covered

    const res = computeInsightsForUser({
      userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents,
      diaryEntries,
      timezone: 'UTC',
    });

    const all = res.payload.buckets.flatMap(b => b.items);

    expect(all.length).toBe(0);
  });

  it('flags early-sign pattern in 0–12h window', () => {
    const userId = 'user_early';
    const nowUtc = d('2025-02-05T12:00:00Z');
    const cfg = {
      ...baseCfg,
      earlySignCloseHours: 2,
      alpha: 1,
      minAttackStarts: 6,
      highConfidenceAttackStarts: 6,
      minCaseMoments: 1,
      controlGuardHours: 0,
    };
    const episodes = [
      { id: 1, startTime: d('2025-01-06T12:00:00Z'), endTime: d('2025-01-06T13:00:00Z'), isOngoing: false },
      { id: 2, startTime: d('2025-01-09T12:00:00Z'), endTime: d('2025-01-09T13:00:00Z'), isOngoing: false },
      { id: 3, startTime: d('2025-01-12T12:00:00Z'), endTime: d('2025-01-12T13:00:00Z'), isOngoing: false },
      { id: 4, startTime: d('2025-01-15T12:00:00Z'), endTime: d('2025-01-15T13:00:00Z'), isOngoing: false },
      { id: 5, startTime: d('2025-01-18T12:00:00Z'), endTime: d('2025-01-18T13:00:00Z'), isOngoing: false },
      { id: 6, startTime: d('2025-01-21T12:00:00Z'), endTime: d('2025-01-21T13:00:00Z'), isOngoing: false },
    ];
    const factors = [{ id: 'f', displayName: 'Nausea', type: 'symptom' as const }];
    const factorEvents = episodes.map(ep => ({
      factorId: 'f',
      occurredAt: new Date(ep.startTime.getTime() - 60 * 60 * 1000),
    }));
    const earlyDays = diaryForDays('2025-01-27T00:00:00Z', 5);
    const episodeDays = episodes.map(ep => ({ localDate: ep.startTime.toISOString().slice(0, 10) }));
    const diaryEntries = [...earlyDays, ...episodeDays];

    const res = computeInsightsForUser({
      userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents,
      diaryEntries,
      timezone: 'UTC',
    });

    const all = res.payload.buckets.flatMap(b => b.items);
    const card = all.find(c => c.factorId === 'f');

    expect(card?.possibleEarlySign).toBe(true);
  });
});
