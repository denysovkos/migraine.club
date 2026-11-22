// Writes internal/luxon/testdata/fromiso.json: DateTime.fromISO results from
// real Luxon for the Go port's golden test. Run: npx tsx scripts/luxon-golden.mts
import { writeFileSync } from 'node:fs';
import { DateTime, Settings } from 'luxon';

const inputs = [
  '2024-01-15',
  '2024-1-15',
  '20240115',
  '2024-01',
  '202401',
  '2024',
  '2024-0115',
  '202401-15',
  '2024-02-29',
  '2023-02-29',
  '2024-02-30',
  '2024-04-31',
  '2024-13-01',
  '2024-00-10',
  '2024-01-00',
  '2024-12-31',
  '+002024-03-01',
  '-000001-01-01',
  '+275760-09-13',
  '+275761-01-01',
  '0099-05-05',
  '0000-01-01',
  '2024-03-31T02:30',
  '2024-10-27T02:30',
  '2024-03-10T02:30',
  '2024-11-03T01:30',
  '2024-01-15T24:00',
  '2024-01-15T24:01',
  '2024-01-15T23:59:59.999',
  '2024-01-15T10:00:00.1234567',
  '2024-01-15T10:00:00,5',
  '2024-01-15t10:00',
  '2024-01-15T10',
  '2024-01-15T1000',
  '2024-01-15T10:00Z',
  '2024-01-15T10:00z',
  '2024-01-15T23:30-05:00',
  '2024-01-15T23:30+0530',
  '2024-01-15T00:30-00:30',
  '2024-01-15T10:00[America/New_York]',
  '2024-01-15T10:00+01:00[Asia/Tokyo]',
  '2024-01-15T10:00[Not/AZone]',
  '2024-01-15T10:60',
  '2024-01-15T10:00:60',
  '2024-01-15 10:00',
  '2024-W01',
  '2024-W01-1',
  '2024W017',
  '2020-W53-5',
  '2021-W53-1',
  '2024-W00-1',
  '2024-W01-8',
  '2024-001',
  '2024001',
  '2024-366',
  '2023-366',
  '2024-000',
  '2024-060T12:00',
  '10:00',
  'T10:00',
  '10:00Z',
  '23:30:15.5',
  '25:00',
  '',
  ' 2024-01-15',
  '2024-01-15 ',
  'foo',
  '2024/01/15',
  '15.01.2024',
  'null',
  '2024-01-15T',
  '2024-01-15T10:00:00.',
];
const zones = ['Europe/Berlin', 'America/New_York', 'UTC', 'Asia/Kolkata', 'Australia/Lord_Howe', 'America/Santiago', 'Pacific/Apia'];
const nows = [Date.UTC(2024, 6, 1, 12), Date.UTC(2024, 0, 15, 6)];

const cases = [];
for (const now of nows) {
  Settings.now = () => now;
  for (const zone of zones) {
    for (const input of inputs) {
      const dt = DateTime.fromISO(input, { zone });
      cases.push({ input, zone, now, valid: dt.isValid, ms: dt.isValid ? dt.toMillis() : null, date: dt.toISODate() });
    }
  }
}
writeFileSync('internal/luxon/testdata/fromiso.json', `${JSON.stringify(cases, null, 1)}\n`);
console.log(cases.length, 'cases');
