import { describe, expect, it } from 'vitest';

import { normalizeToPainLevel, painLevelDisplay } from './painLevel';

describe('normalizeToPainLevel', () => {
  it('maps legacy 0 to null', () => {
    expect(normalizeToPainLevel(0)).toBeNull();
  });

  it('keeps new values 1..5 as-is', () => {
    expect(normalizeToPainLevel(1)).toBe(1);
    expect(normalizeToPainLevel(5)).toBe(5);
  });

  it('maps legacy 0–10 values into 1–5 buckets', () => {
    // Values 1–5 are treated as already-normalized (new scale).
    // Legacy values > 5 (from the old 0–10 scale) are bucketed down.
    expect(normalizeToPainLevel(6)).toBe(3);
    expect(normalizeToPainLevel(7)).toBe(4);
    expect(normalizeToPainLevel(10)).toBe(5);
  });
});

describe('painLevelDisplay', () => {
  it('shows 5 as 5+', () => {
    expect(painLevelDisplay(5)).toBe('5+');
  });
});
