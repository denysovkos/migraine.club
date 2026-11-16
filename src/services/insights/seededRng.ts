/**
 * Tiny deterministic PRNG (xorshift32) for reproducible permutation tests.
 * Not cryptographically secure.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure non-zero 32-bit seed
    const s = seed | 0;
    this.state = s === 0 ? 0x1A2B3C4D : s;
  }

  nextUint32(): number {
    // xorshift32
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return this.state >>> 0;
  }

  nextFloat01(): number {
    // [0, 1)
    return this.nextUint32() / 0x1_0000_0000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) {
      throw new Error('invalid range');
    }
    const span = maxInclusive - minInclusive + 1;
    const n = this.nextUint32() % span;
    return minInclusive + n;
  }
}

export function hashStringToSeed32(input: string): number {
  // FNV-1a 32-bit
  let hash = 0x811C9DC5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
