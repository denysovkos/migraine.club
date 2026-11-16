import { describe, expect, it } from 'vitest';

import { computeWpi, toLevel } from './computeWpi';

describe('toLevel', () => {
  it('returns "low" for scores below 2.5', () => {
    expect(toLevel(0)).toBe('low');
    expect(toLevel(1.0)).toBe('low');
    expect(toLevel(2.4)).toBe('low');
  });

  it('returns "moderate" for scores between 2.5 and 5.0', () => {
    expect(toLevel(2.5)).toBe('moderate');
    expect(toLevel(3.5)).toBe('moderate');
    expect(toLevel(4.9)).toBe('moderate');
  });

  it('returns "high" for scores between 5.0 and 7.5', () => {
    expect(toLevel(5.0)).toBe('high');
    expect(toLevel(6.0)).toBe('high');
    expect(toLevel(7.4)).toBe('high');
  });

  it('returns "very_high" for scores 7.5 and above', () => {
    expect(toLevel(7.5)).toBe('very_high');
    expect(toLevel(8.5)).toBe('very_high');
    expect(toLevel(10.0)).toBe('very_high');
  });
});

describe('computeWpi', () => {
  it('returns low WPI for calm weather conditions', () => {
    const result = computeWpi({
      deltaPressure: 2, // Low pressure change
      temperatureDeviation: 2, // Low temp swing
      humidity: 50, // Moderate humidity
      windSpeed: 1, // Low wind
      uvi: 2, // Low UV
      kpIndex: 1, // Quiet solar
    });

    expect(result.score).toBeLessThan(2.5);
    expect(result.level).toBe('low');
  });

  it('returns very_high WPI for extreme conditions', () => {
    const result = computeWpi({
      deltaPressure: 20, // High pressure change
      temperatureDeviation: 15, // High temp swing
      humidity: 90, // High humidity
      windSpeed: 12, // High wind
      uvi: 10, // High UV
      kpIndex: 8, // Geomagnetic storm
    });

    expect(result.score).toBeGreaterThanOrEqual(7.5);
    expect(result.level).toBe('very_high');
  });

  it('handles null kpIndex gracefully', () => {
    const result = computeWpi({
      deltaPressure: 8,
      temperatureDeviation: 6,
      humidity: 60,
      windSpeed: 5,
      uvi: 4,
      kpIndex: null, // No solar data
    });

    expect(result.components.solarFactor).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it('clamps factors to 0-1 range for extreme values', () => {
    const result = computeWpi({
      deltaPressure: 100, // Way above max
      temperatureDeviation: 50,
      humidity: 150, // Above 100%
      windSpeed: 50,
      uvi: 20,
      kpIndex: 9,
    });

    // All factors should be clamped to 1
    expect(result.components.pressureFactor).toBeLessThanOrEqual(1);
    expect(result.components.humidityFactor).toBeLessThanOrEqual(1);
    expect(result.components.tempFactor).toBeLessThanOrEqual(1);
    expect(result.components.windFactor).toBeLessThanOrEqual(1);
    expect(result.components.uviFactor).toBeLessThanOrEqual(1);
    expect(result.components.solarFactor).toBeLessThanOrEqual(1);

    // Score should be at max
    expect(result.score).toBe(10);
    expect(result.level).toBe('very_high');
  });

  it('clamps factors to 0 for negative or very low values', () => {
    const result = computeWpi({
      deltaPressure: -5,
      temperatureDeviation: -2,
      humidity: 10, // Very low
      windSpeed: 0,
      uvi: 0,
      kpIndex: 0,
    });

    expect(result.components.pressureFactor).toBe(0);
    expect(result.components.humidityFactor).toBe(0);
    expect(result.components.tempFactor).toBe(0);
    expect(result.components.windFactor).toBe(0);
    expect(result.components.uviFactor).toBe(0);
    expect(result.components.solarFactor).toBe(0);

    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  it('returns moderate WPI for mixed conditions', () => {
    const result = computeWpi({
      deltaPressure: 8, // 50% of max
      temperatureDeviation: 6, // 50% of max
      humidity: 60, // 50% of range
      windSpeed: 6, // 50% of range
      uvi: 4.5, // ~50% of range
      kpIndex: 4, // 50% of range
    });

    // Should be roughly in the middle range
    expect(result.score).toBeGreaterThanOrEqual(2.5);
    expect(result.score).toBeLessThan(7.5);
  });

  it('high pressure change dominates due to higher weight', () => {
    const lowPressure = computeWpi({
      deltaPressure: 2,
      temperatureDeviation: 6,
      humidity: 60,
      windSpeed: 5,
      uvi: 4,
      kpIndex: 3,
    });

    const highPressure = computeWpi({
      deltaPressure: 18, // Only this changes
      temperatureDeviation: 6,
      humidity: 60,
      windSpeed: 5,
      uvi: 4,
      kpIndex: 3,
    });

    // High pressure should increase score significantly (0.25 weight)
    expect(highPressure.score - lowPressure.score).toBeGreaterThan(1);
  });

  it('returns consistent scores for same input', () => {
    const input = {
      deltaPressure: 10,
      temperatureDeviation: 8,
      humidity: 70,
      windSpeed: 7,
      uvi: 5,
      kpIndex: 4,
    };

    const result1 = computeWpi(input);
    const result2 = computeWpi(input);

    expect(result1.score).toBe(result2.score);
    expect(result1.level).toBe(result2.level);
    expect(result1.components).toEqual(result2.components);
  });

  it('rounds score to one decimal place', () => {
    const result = computeWpi({
      deltaPressure: 7,
      temperatureDeviation: 5,
      humidity: 55,
      windSpeed: 4,
      uvi: 3,
      kpIndex: 3,
    });

    // Check that score has at most 1 decimal place
    const decimalPlaces = (result.score.toString().split('.')[1] || '').length;

    expect(decimalPlaces).toBeLessThanOrEqual(1);
  });

  it('rounds component factors to two decimal places', () => {
    const result = computeWpi({
      deltaPressure: 7,
      temperatureDeviation: 5,
      humidity: 55,
      windSpeed: 4,
      uvi: 3,
      kpIndex: 3,
    });

    Object.values(result.components).forEach((factor) => {
      const decimalPlaces = (factor.toString().split('.')[1] || '').length;

      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });
});
