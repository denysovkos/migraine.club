import type { WpiInput, WpiLevelType, WpiResult } from '@/types/WeatherPainIndex';

/**
 * Clamps a value between min and max
 */
const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * Weights for each factor (sum to 1.0)
 */
const WEIGHTS = {
  pressure: 0.25,
  humidity: 0.20,
  temp: 0.15,
  wind: 0.15,
  uvi: 0.10,
  solar: 0.15,
} as const;

/**
 * Converts a raw WPI score (0.0-10.0) to a human-readable level
 */
export function toLevel(score: number): WpiLevelType {
  if (score < 2.5) {
    return 'low';
  }
  if (score < 5.0) {
    return 'moderate';
  }
  if (score < 7.5) {
    return 'high';
  }
  return 'very_high';
}

/**
 * Pure function that computes the Weather Pain Index
 *
 * The WPI is calculated from various weather and solar activity factors:
 * - Pressure volatility (delta pressure in hPa)
 * - Humidity (%)
 * - Temperature swing (°C deviation)
 * - Wind speed (m/s)
 * - UV index
 * - Solar/geomagnetic activity (Kp index)
 *
 * Each factor is normalized to 0-1 range and then weighted.
 * The final score is scaled to 0-10.
 */
export function computeWpi(input: WpiInput): WpiResult {
  const {
    deltaPressure,
    temperatureDeviation,
    humidity,
    windSpeed,
    uvi,
    kpIndex,
  } = input;

  // Normalize factors to 0-1 range
  // 0 hPa → 0; ≥16 hPa → 1
  const pressureFactor = clamp(deltaPressure / 16, 0, 1);

  // <40% → 0; ≥80% → 1
  const humidityFactor = clamp((humidity - 40) / (80 - 40), 0, 1);

  // 0°C swing → 0; ≥12°C → 1
  const tempFactor = clamp(temperatureDeviation / 12, 0, 1);

  // ≤2 m/s → 0; ≥10 m/s → 1
  const windFactor = clamp((windSpeed - 2) / (10 - 2), 0, 1);

  // UVI 1 → 0; ≥8 → 1
  const uviFactor = clamp((uvi - 1) / (8 - 1), 0, 1);

  // Kp ≤2 (quiet) → 0; ≥6 (storm) → 1
  let solarFactor = 0;
  if (kpIndex != null) {
    solarFactor = clamp((kpIndex - 2) / (6 - 2), 0, 1);
  }

  // Combine with weights
  const wpiRaw
    = WEIGHTS.pressure * pressureFactor
      + WEIGHTS.humidity * humidityFactor
      + WEIGHTS.temp * tempFactor
      + WEIGHTS.wind * windFactor
      + WEIGHTS.uvi * uviFactor
      + WEIGHTS.solar * solarFactor;

  // Scale to 0.0-10.0 and round to 1 decimal place
  const score = Math.round(wpiRaw * 10 * 10) / 10;

  return {
    score,
    level: toLevel(score),
    components: {
      pressureFactor: Math.round(pressureFactor * 100) / 100,
      humidityFactor: Math.round(humidityFactor * 100) / 100,
      tempFactor: Math.round(tempFactor * 100) / 100,
      windFactor: Math.round(windFactor * 100) / 100,
      uviFactor: Math.round(uviFactor * 100) / 100,
      solarFactor: Math.round(solarFactor * 100) / 100,
    },
  };
}
