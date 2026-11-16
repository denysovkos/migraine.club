import type { ProgramAdherenceSignal } from '@/models/Schema';

/**
 * Computes whether an acute medication dose was taken within the target window
 * after attack onset.
 *
 * - Returns `na` when no dose was taken, or when the delta is negative (data
 *   error: dose timestamp before onset). We don't penalise the user.
 * - Returns `hit` when delta ≤ target.
 * - Returns `miss` when delta > target.
 */
export function computeAcuteAttackSignal(args: {
  targetMinutes: number;
  onsetToDoseMinutes: number | null;
}): { signal: ProgramAdherenceSignal; onsetToDoseMinutes: number | null } {
  const { targetMinutes, onsetToDoseMinutes } = args;
  if (onsetToDoseMinutes === null || onsetToDoseMinutes < 0) {
    return { signal: 'na', onsetToDoseMinutes };
  }
  return {
    signal: onsetToDoseMinutes <= targetMinutes ? 'hit' : 'miss',
    onsetToDoseMinutes,
  };
}
