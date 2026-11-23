// Writes internal/service/preventives/testdata/schedule.json: results of the
// TS schedule functions over a deterministic corpus, for the Go port's golden
// test. Run: npx tsx --tsconfig scripts/golden.tsconfig.json scripts/preventives-golden.mts
import type { LocalDateString } from '../src/services/localDate';
import { writeFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { resolvePlanWindows } from '../src/services/preventives/metrics';
import { getDueStatus, isDueOnDate, resolveAdherenceForRange, scheduleLabel } from '../src/services/preventives/schedule';

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
function pick<T>(xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

const kinds = ['oral', 'injection', 'infusion', 'device'];
const types = ['daily', 'weekdays', 'every_n_days', 'every_n_weeks', 'custom_weekdays', 'on_specific_dates', 'bogus'];
const payloads: unknown[] = [
  null,
  {},
  [],
  { n: 1 },
  { n: 2 },
  { n: 3 },
  { n: 4 },
  { n: 1.5 },
  { n: 0 },
  { n: -2 },
  { n: '2' },
  { n: 1e300 },
  [1, 3, 5],
  [7, 7, 1],
  [0, 8, 2.5, 3],
  [6, 2],
  ['2025-01-02', 'x', '2025-02-10'],
  ['2025-03-05'],
  'str',
  5,
];
const starts = ['2024-12-30', '2025-01-01', '2025-01-15', '2025-02-28', '2025-03-30', '2025-10-26'];
const day = (base: string, offset: number) => DateTime.fromISO(base, { zone: 'UTC' }).plus({ days: offset }).toISODate()! as LocalDateString;
const states = ['taken', 'missed', 'unsure', 'other'];
const zone = 'Europe/Berlin';

const cases = [];
for (let i = 0; i < 600; i++) {
  const plan = {
    id: `p${i}`,
    kind: pick(kinds),
    scheduleType: pick(types),
    schedulePayload: pick(payloads),
    startDate: pick(starts),
    status: pick(['active', 'paused', 'stopped']),
  } as any;
  const events = Array.from({ length: Math.floor(rand() * 8) }, () => ({
    localDate: day(plan.startDate, Math.floor(rand() * 90) - 10),
    state: pick(states),
  })) as any[];
  const dates = Array.from({ length: 6 }, () => day(plan.startDate, Math.floor(rand() * 120) - 10));
  const from = day(plan.startDate, Math.floor(rand() * 60) - 10);
  const to = day(from, Math.floor(rand() * 40));
  cases.push({
    plan,
    events,
    label: scheduleLabel(plan),
    checks: dates.map((localDate) => {
      const s = getDueStatus({ plan, localDate, timezone: zone, events });
      return {
        localDate,
        isDueOnDate: isDueOnDate({ plan, localDate, timezone: zone }),
        isDue: s.isDue,
        isOverdue: s.isOverdue,
        canLogToday: s.canLogToday,
        matched: s.matchedEvent ? events.indexOf(s.matchedEvent) : -1,
      };
    }),
    from,
    to,
    adherence: resolveAdherenceForRange({ plan, from, to, timezone: zone, events }),
    windows: resolvePlanWindows({ startDate: plan.startDate, timezone: zone, todayLocalDate: to }),
  });
}
writeFileSync('internal/service/preventives/testdata/schedule.json', `${JSON.stringify(cases)}\n`);
console.log(cases.length, 'cases');
