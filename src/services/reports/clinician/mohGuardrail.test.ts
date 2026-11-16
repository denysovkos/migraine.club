import { describe, expect, it } from 'vitest';

import { calculateMohGuardrail } from '@/services/reports/clinician/mohGuardrail';

describe('calculateMohGuardrail', () => {
  it('returns low for conservative safe range', () => {
    expect(calculateMohGuardrail(5).status).toBe('low');
  });

  it('returns watch for moderate usage', () => {
    expect(calculateMohGuardrail(10).status).toBe('watch');
  });

  it('returns high for elevated usage', () => {
    expect(calculateMohGuardrail(15).status).toBe('high');
  });
});
