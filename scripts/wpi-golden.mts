// Golden outputs of computeWpi for the Go port (internal/service/wpi).
import { writeFileSync } from 'node:fs';
import { computeWpi } from '../src/services/computeWpi';

let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const cases: any[] = [
  { deltaPressure: 2, temperatureDeviation: 2, humidity: 50, windSpeed: 1, uvi: 2, kpIndex: 1 },
  { deltaPressure: 20, temperatureDeviation: 15, humidity: 90, windSpeed: 12, uvi: 10, kpIndex: 8 },
  { deltaPressure: 8, temperatureDeviation: 6, humidity: 60, windSpeed: 5, uvi: 4, kpIndex: null },
  { deltaPressure: 100, temperatureDeviation: 50, humidity: 150, windSpeed: 50, uvi: 20, kpIndex: 9 },
  { deltaPressure: -5, temperatureDeviation: -2, humidity: 10, windSpeed: 0, uvi: 0, kpIndex: 0 },
  { deltaPressure: 8, temperatureDeviation: 6, humidity: 60, windSpeed: 6, uvi: 4.5, kpIndex: 4 },
];
for (let i = 0; i < 500; i++) {
  cases.push({
    deltaPressure: Math.round(rnd() * 2000) / 100,
    temperatureDeviation: Math.round(rnd() * 1500) / 100,
    humidity: Math.round(rnd() * 10000) / 100,
    windSpeed: Math.round(rnd() * 1500) / 100,
    uvi: Math.round(rnd() * 1100) / 100,
    kpIndex: rnd() < 0.2 ? null : Math.round(rnd() * 900) / 100,
  });
}
writeFileSync('internal/service/wpi/testdata/golden.json', JSON.stringify(cases.map(input => ({ input, output: computeWpi(input) }))));
