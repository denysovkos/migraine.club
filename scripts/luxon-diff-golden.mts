// Writes internal/luxon/testdata/diffdays.json: DateTime#diff(other, 'days')
// across zones, for the Go port. Run: npx tsx scripts/luxon-diff-golden.mts
import { writeFileSync } from 'node:fs';
import { DateTime } from 'luxon';

let seed = 99;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const zones = ['Europe/Berlin', 'UTC', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata'];
const base = Date.UTC(2025, 2, 25);
const cases = [];
for (let i = 0; i < 3000; i++) {
  const aZone = zones[Math.floor(rand() * zones.length)]!;
  const bZone = rand() < 0.5 ? 'UTC' : zones[Math.floor(rand() * zones.length)]!;
  const aMs = base + Math.floor(rand() * 400) * 3600_000 * (rand() < 0.3 ? 1 : 24) + Math.floor(rand() * 3600) * 1000;
  const aMidnight = rand() < 0.5;
  const a = aMidnight ? DateTime.fromMillis(aMs, { zone: aZone }).startOf('day') : DateTime.fromMillis(aMs, { zone: aZone });
  const bMs = aMs - Math.floor(rand() * 20 * 86400_000) + Math.floor(rand() * 2 * 86400_000);
  const b = DateTime.fromMillis(bMs, { zone: bZone });
  const plusN = Math.floor(rand() * 40) - 20;
  cases.push({ a: a.toMillis(), aZone, b: bMs, bZone, days: a.diff(b, 'days').days, plusN, plus: a.plus({ days: plusN }).toMillis() });
}
writeFileSync('internal/luxon/testdata/diffdays.json', `${JSON.stringify(cases)}\n`);
console.log(cases.length);
