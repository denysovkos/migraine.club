import { DateTime } from 'luxon';

export type EnrollmentWindows = {
  baselineWindowStart: string;
  baselineWindowEnd: string;
  evaluationWindowStart: string;
  evaluationWindowEnd: string;
  rampDays: number;
};

/**
 * Compute baseline (28d immediately before start), 14d ramp, then 28d evaluation.
 * Mirrors `docs/PREVENTIVE_TREATMENTS.md` window logic so program outcomes can
 * be compared against preventives' outcomes consistently.
 */
export function computeEnrollmentWindows(args: { startDate: string; timezone: string }): EnrollmentWindows {
  const start = DateTime.fromISO(args.startDate, { zone: args.timezone });
  const baselineEnd = start.minus({ days: 1 });
  const baselineStart = baselineEnd.minus({ days: 27 });
  const evalStart = start.plus({ days: 14 });
  const evalEnd = evalStart.plus({ days: 27 });

  return {
    baselineWindowStart: baselineStart.toISODate()!,
    baselineWindowEnd: baselineEnd.toISODate()!,
    evaluationWindowStart: evalStart.toISODate()!,
    evaluationWindowEnd: evalEnd.toISODate()!,
    rampDays: 14,
  };
}
