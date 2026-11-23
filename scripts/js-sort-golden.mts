// Writes internal/jsx/testdata/sort.json: Array.prototype.sort results from
// V8 for jsx.SortJS, including comparators that return NaN or are not
// consistent (where only V8's exact TimSort gives the same order), and
// JS-object tallies with keys that shadow Object.prototype.
// Run: npx tsx scripts/js-sort-golden.mts
import { writeFileSync } from 'node:fs';

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

type Item = { id: number; v: number | string };
const sizes = [0, 1, 2, 3, 5, 8, 13, 31, 32, 33, 63, 64, 65, 100, 129, 257, 600, 1500];
const cases: { kind: string; items: Item[]; order: number[] }[] = [];

// Non-transitive but deterministic: depends only on the two ids.
const chaos = (a: Item, b: Item) => ((a.id * 7919 + b.id * 104729) % 5) - 2;

for (const n of sizes) {
  for (const kind of ['numbers', 'nan', 'chaos', 'runs']) {
    const items: Item[] = [];
    for (let i = 0; i < n; i++) {
      let v: number | string = Math.floor(rand() * Math.max(2, n / 4));
      if (kind === 'nan' && rand() < 0.2) {
        v = `function toString() { [native code] }${'1'.repeat(1 + Math.floor(rand() * 3))}`;
      }
      if (kind === 'runs') {
        v = i % 50 < 25 ? i : n - i;
      }
      items.push({ id: i, v });
    }
    const sorted = [...items];
    if (kind === 'chaos') {
      sorted.sort(chaos);
    } else {
      sorted.sort((a, b) => (b.v as number) - (a.v as number));
    }
    cases.push({ kind, items, order: sorted.map(x => x.id) });
  }
}

const tallyKeys = [
  ['stress', 'constructor', 'stress', '__proto__', 'toString', '10', 'constructor', 'valueOf', '2', 'hasOwnProperty', 'stress', 'toString', 'toString'],
  ['a', 'b', 'a', '__defineGetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__lookupSetter__', '__lookupGetter__', '__defineSetter__', 'b', 'a'],
  ['x', 'y', 'z', 'y', 'z', 'z', '01', '1', '4294967295', '4294967294'],
];
const tallies = tallyKeys.map((keys) => {
  const counts: Record<string, number> = {};
  for (const k of keys) {
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  const sorted = [...entries].sort(([, a], [, b]) => b - a);
  return { keys, entries, sorted };
});

writeFileSync('internal/jsx/testdata/sort.json', `${JSON.stringify({ cases, tallies })}\n`);
