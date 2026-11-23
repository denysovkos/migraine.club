// Writes internal/jsx/testdata/fdlibm.json: V8 Math.log / Math.exp results
// for the Go port's bit-exact test. Run: npx tsx scripts/fdlibm-golden.mts
import { writeFileSync } from 'node:fs';

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const logIn: number[] = [0, -0, 1, 2, Math.E, 0.5, 1e-310, 5e-324, 1.7976931348623157e308, Number.POSITIVE_INFINITY, -1, 1 + 2 ** -21, 1 - 2 ** -22, 1 + 2 ** -52];
for (let i = 1; i <= 3000; i++) {
  logIn.push(i);
}
for (let i = 0; i < 4000; i++) {
  logIn.push(rand() * 10 ** Math.floor(rand() * 40 - 20), 1 + (rand() - 0.5) * 1e-5, 0.5 + rand());
}
const expIn: number[] = [0, -0, 1, -1, 0.5, 709.78, 709.8, -745.1, -745.2, -708.5, -720.3, 2 ** -29, -(2 ** -29), 0.34657, 1.0397, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
for (let i = 0; i < 6000; i++) {
  expIn.push((rand() - 0.5) * 1500, (rand() - 0.5) * 4, -rand() * 60);
}

const out = {
  log: logIn.map(x => [x, Math.log(x)]),
  exp: expIn.map(x => [x, Math.exp(x)]),
};
writeFileSync('internal/jsx/testdata/fdlibm.json', `${JSON.stringify(out, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? '-0' : v))}\n`);
console.log(out.log.length + out.exp.length, 'cases');
