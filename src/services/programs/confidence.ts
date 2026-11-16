export type Confidence = 'low' | 'medium' | 'high';

export function computeConfidence(args: {
  coverage: number; // 0..1 diary coverage in eval window
  adherence: number; // 0..1 hit rate over due days
  evalComplete: boolean;
}): Confidence {
  if (!args.evalComplete || args.coverage < 0.7 || args.adherence < 0.4) {
    return 'low';
  }
  if (args.coverage >= 0.9 && args.adherence >= 0.7) {
    return 'high';
  }
  return 'medium';
}
