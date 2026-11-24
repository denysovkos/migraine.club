import { describe, expect, it } from 'vitest';

import { formatChange, weekdayLabel } from './pressureFormat';

describe('weekdayLabel', () => {
  it('formats the calendar date without shifting it', () => {
    expect(weekdayLabel('2026-11-20', 'en')).toBe('Fri');
    expect(weekdayLabel('2026-11-22', 'en')).toBe('Sun');
  });
});

describe('formatChange', () => {
  it('signs rises and keeps one decimal', () => {
    expect(formatChange(3)).toBe('+3.0');
    expect(formatChange(-7)).toBe('-7.0');
    expect(formatChange(0)).toBe('0.0');
  });
});
