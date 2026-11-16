export type BhResult = {
  pValues: number[];
  qValues: number[];
};

/**
 * Benjamini–Hochberg FDR adjustment.
 *
 * Returns q-values in the original order.
 */
export function benjaminiHochberg(pValues: number[]): BhResult {
  const m = pValues.length;
  if (m === 0) {
    return { pValues: [], qValues: [] };
  }

  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const qSorted = Array.from<number>({ length: m }).fill(0);
  for (let rank = 1; rank <= m; rank++) {
    const p = indexed[rank - 1]!.p;
    qSorted[rank - 1] = (p * m) / rank;
  }

  // Enforce monotonicity from largest to smallest (q_i = min(q_i, q_{i+1}))
  for (let i = m - 2; i >= 0; i--) {
    qSorted[i] = Math.min(qSorted[i]!, qSorted[i + 1]!);
  }

  // Map back to original order; clamp to [0,1]
  const qValues = Array.from<number>({ length: m }).fill(0);
  for (let k = 0; k < m; k++) {
    const origIdx = indexed[k]!.i;
    qValues[origIdx] = Math.max(0, Math.min(1, qSorted[k]!));
  }

  return { pValues, qValues };
}
