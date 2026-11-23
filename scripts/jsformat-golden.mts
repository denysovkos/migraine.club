// Writes internal/jsx/testdata/format.json: V8 toFixed and localeCompare
// results for the Go port. Run: npx tsx scripts/jsformat-golden.mts
import { writeFileSync } from 'node:fs';

let seed = 5;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const nums = [0.25, 0.35, 1.005, 2.5, -2.5, -0.04, -0.05, 0, 1e-7, 123.456, 0.05, 0.15, 1.45, 8.345, 99.95, 1234.5678, 5e-324];
for (let i = 0; i < 3000; i++) {
  nums.push(Math.round(rand() * 100000) / 1000, (rand() - 0.5) * 1000, rand() * 48);
}
const toFixed = nums.flatMap(x => [0, 1, 2, 3].map(d => [x, d, x.toFixed(d)]));
const words = ['apple', 'Apple', 'APPLE', 'banana', 'Ibuprofen', 'ibuprofen 400', 'Ибупрофен', 'парацетамол', 'Парацетамол', 'Äpfel', 'apfel', 'zeta', 'Zeta', 'éclair', 'eclair', 'a-b', 'ab', 'a b', 'a_b', '10 mg', '2 mg', 'Ü', 'u', 'ß', 'ss', '', ' ', '中文', 'Ω', 'ω', 'Ömer', 'oz', '😀', 'x1', 'x10', 'x2', 'Sumatriptan', 'Rizatriptan', 'naproxen sodium', 'Naproxen'];
const compare = [];
for (const a of words) {
  for (const b of words) {
    compare.push([a, b, Math.sign(a.localeCompare(b))]);
  }
}
const roundInputs = [0.49999999999999994, -0.49999999999999994, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, -0.4, 4503599627370497, -4503599627370497, 9007199254740991, 1.7976931348623157e308, 5e-324, -5e-324, 0, 2.4999999999999996, 1e21, -1e21, ...nums.slice(0, 600).map(x => x * 10)];
// [x, Math.round(x), Object.is(result, -0)]
const round = roundInputs.map(x => [x, Math.round(x), Object.is(Math.round(x), -0)]);
writeFileSync('internal/jsx/testdata/format.json', `${JSON.stringify({ toFixed, compare, round })}\n`);
console.log(toFixed.length, compare.length);
