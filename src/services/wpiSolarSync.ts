export function shouldRecomputeWpiForKpChange(args: {
  recentKp: number | null;
  currentAvgKp: number | null;
}): boolean {
  const { recentKp, currentAvgKp } = args;

  // If we don't have a current Kp reading, don't force recompute.
  if (currentAvgKp === null) {
    return false;
  }

  // If the snapshot was computed without Kp but we have one now, recompute.
  if (recentKp === null) {
    return true;
  }

  // Require exact match for display parity; allow tiny float noise.
  return Math.abs(recentKp - currentAvgKp) > 1e-6;
}
