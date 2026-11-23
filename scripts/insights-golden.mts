// Writes internal/service/insights/testdata/engine.json: computeInsightsForUser
// payloads (runtimeMs zeroed) for generated users, for the Go port's golden
// test. Run: npx tsx --tsconfig scripts/golden.tsconfig.json scripts/insights-golden.mts
import { writeFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { computeInsightsForUser, DEFAULT_INSIGHTS_ENGINE_CONFIG } from '../src/services/insights/InsightsEngine';

let seed = 1234;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
function pick<T>(xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

const zones = ['Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Apia'];
const types = ['trigger', 'trigger', 'protector', 'symptom'];
const nows = ['2025-03-31T10:15:30.123Z', '2025-10-27T01:30:00.000Z', '2026-01-15T23:59:59.999Z', '2025-07-01T12:00:00.000Z'];
const H = 3600_000;

const cases = [];
for (let i = 0; i < 160; i++) {
  const windowDays = pick([30, 60, 90, 180]);
  const zone = pick(zones);
  const nowUtc = new Date(pick(nows));
  const userId = pick(['user_a', 'e2e_user_test_001', 'юзер_7', `u${i}`]);
  const coverage = 0.4 + rand() * 0.6;
  const endLocal = DateTime.fromJSDate(nowUtc, { zone }).startOf('day');
  const diary: string[] = [];
  for (let d = 0; d < windowDays + 3; d++) {
    if (rand() < coverage) {
      diary.push(endLocal.minus({ days: d }).toISODate()!);
    }
  }
  diary.sort(() => rand() - 0.5);
  const nEpisodes = Math.floor(rand() * 30);
  const episodes = Array.from({ length: nEpisodes }, (_, k) => {
    const start = nowUtc.getTime() - Math.floor(rand() * (windowDays + 4) * 24) * H - Math.floor(rand() * 3600) * 1000;
    const kind = rand();
    return {
      id: k + 1,
      startTime: new Date(start),
      endTime: kind < 0.6 ? new Date(start + Math.floor(rand() * 30) * H) : null,
      isOngoing: kind > 0.9,
    };
  });
  const factors = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, k) => ({
    id: `f${k}-${i}`,
    displayName: `Factor ${k}`,
    type: pick(types) as any,
  }));
  const events: { factorId: string; occurredAt: Date }[] = [];
  for (const f of factors) {
    const causal = rand() < 0.5;
    const lead = pick([1, 6, 18, 30]);
    for (const ep of episodes) {
      if (causal && rand() < 0.8) {
        events.push({ factorId: f.id, occurredAt: new Date(ep.startTime.getTime() - lead * H - Math.floor(rand() * 3) * H) });
      }
    }
    const background = Math.floor(rand() * windowDays * (causal ? 0.1 : 0.4));
    for (let b = 0; b < background; b++) {
      events.push({ factorId: f.id, occurredAt: new Date(nowUtc.getTime() - Math.floor(rand() * windowDays * 24) * H) });
    }
  }
  if (rand() < 0.1) {
    events.push({ factorId: 'unknown-factor', occurredAt: new Date(nowUtc.getTime() - 5 * H) });
  }
  events.sort(() => rand() - 0.5);
  const cfg = { ...DEFAULT_INSIGHTS_ENGINE_CONFIG, windowDays, minDiaryDays: Math.min(45, Math.floor(windowDays * 0.5)) };
  const result = computeInsightsForUser({
    userId,
    nowUtc,
    cfg,
    episodes,
    factors,
    factorEvents: events,
    diaryEntries: diary.map(localDate => ({ localDate })),
    timezone: zone,
  });
  result.payload.inputStats.runtimeMs = 0;
  cases.push({
    userId,
    now: nowUtc.getTime(),
    zone,
    windowDays,
    minDiaryDays: cfg.minDiaryDays,
    episodes: episodes.map(e => ({ id: e.id, start: e.startTime.getTime(), end: e.endTime?.getTime() ?? null, ongoing: e.isOngoing })),
    factors,
    events: events.map(e => ({ factorId: e.factorId, at: e.occurredAt.getTime() })),
    diary,
    status: result.status,
    reason: 'reason' in result ? result.reason : '',
    payload: result.payload,
  });
}
writeFileSync('internal/service/insights/testdata/engine.json', `${JSON.stringify(cases)}\n`);
const statuses = cases.reduce<Record<string, number>>((acc, c) => ({ ...acc, [`${c.status}:${c.reason}`]: (acc[`${c.status}:${c.reason}`] ?? 0) + 1 }), {});
console.log(cases.length, 'cases', statuses, 'cards', cases.reduce((n, c) => n + c.payload.buckets.reduce((m: number, b: any) => m + b.items.length, 0), 0));
