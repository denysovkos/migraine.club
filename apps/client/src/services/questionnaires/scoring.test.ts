import { describe, expect, it } from 'vitest';

import { midasGrade, scoreHit6, scoreMidas, scoreMsq21 } from './scoring';

describe('HIT-6 scoring', () => {
  it('maps answers to points and sums correctly', () => {
    const res = scoreHit6({
      q1: 'NEVER',
      q2: 'RARELY',
      q3: 'SOMETIMES',
      q4: 'VERY_OFTEN',
      q5: 'ALWAYS',
      q6: 'NEVER',
    });

    // 6 + 8 + 10 + 11 + 13 + 6 = 54
    expect(res.scoreTotal).toBe(54);
  });
});

describe('MIDAS scoring', () => {
  it('sums q1..q5', () => {
    const res = scoreMidas({ q1: 1, q2: 2, q3: 3, q4: 4, q5: 5 });

    expect(res.scoreTotal).toBe(15);
  });

  it('assigns grade boundaries correctly', () => {
    expect(midasGrade(0)).toBe('Grade I');
    expect(midasGrade(5)).toBe('Grade I');
    expect(midasGrade(6)).toBe('Grade II');
    expect(midasGrade(10)).toBe('Grade II');
    expect(midasGrade(11)).toBe('Grade III');
    expect(midasGrade(20)).toBe('Grade III');
    expect(midasGrade(21)).toBe('Grade IV');
    expect(midasGrade(100)).toBe('Grade IV');
  });
});

describe('MSQ v2.1 scoring', () => {
  it('computes domain scores and total in 0–100 range', () => {
    const res = scoreMsq21({
      q1: 1,
      q2: 2,
      q3: 3,
      q4: 4,
      q5: 5,
      q6: 6,
      q7: 1,
      q8: 2,
      q9: 3,
      q10: 4,
      q11: 5,
      q12: 6,
      q13: 1,
      q14: 2,
    });

    const d = res.scoreDetails.domains;

    expect(d.restrictive).toBeGreaterThanOrEqual(0);
    expect(d.restrictive).toBeLessThanOrEqual(100);
    expect(d.preventive).toBeGreaterThanOrEqual(0);
    expect(d.preventive).toBeLessThanOrEqual(100);
    expect(d.emotional).toBeGreaterThanOrEqual(0);
    expect(d.emotional).toBeLessThanOrEqual(100);
    expect(d.total).toBeGreaterThanOrEqual(0);
    expect(d.total).toBeLessThanOrEqual(100);
  });
});
