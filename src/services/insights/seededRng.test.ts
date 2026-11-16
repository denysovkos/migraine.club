import { describe, expect, it } from 'vitest';

import { hashStringToSeed32, SeededRng } from './seededRng';

describe('SeededRng', () => {
  it('is deterministic for the same seed', () => {
    const seed = hashStringToSeed32('hello');
    const a = new SeededRng(seed);
    const b = new SeededRng(seed);

    const seqA = Array.from({ length: 10 }, () => a.nextUint32());
    const seqB = Array.from({ length: 10 }, () => b.nextUint32());

    expect(seqA).toEqual(seqB);
  });

  it('produces ints within range', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 100; i++) {
      const x = rng.int(5, 7);

      expect([5, 6, 7]).toContain(x);
    }
  });
});
