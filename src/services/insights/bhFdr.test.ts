import { describe, expect, it } from 'vitest';

import { benjaminiHochberg } from './bhFdr';

describe('benjaminiHochberg', () => {
  it('returns empty arrays for empty input', () => {
    const r = benjaminiHochberg([]);

    expect(r.qValues).toEqual([]);
  });

  it('computes monotone q-values in original order', () => {
    // Example p-values
    const p = [0.01, 0.04, 0.03, 0.2];
    const { qValues } = benjaminiHochberg(p);

    // q-values should be in [0,1]
    expect(qValues.every(x => x >= 0 && x <= 1)).toBe(true);

    // Smallest p should have smallest q (not necessarily strictly)
    expect(qValues.length).toBe(4);
    expect(qValues[0]!).toBeLessThanOrEqual(qValues[1]!);
  });
});
