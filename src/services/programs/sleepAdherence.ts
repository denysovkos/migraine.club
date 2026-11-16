import type { ProgramAdherenceSignal, SleepTargetPayload } from '@/models/Schema';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Smallest absolute distance between two HH:MM times on a 24h circle.
 * Bed time 23:00 vs actual 00:30 → 90, not 23:30.
 */
function circularMinuteDelta(a: string, b: string): number {
  const x = toMinutes(a);
  const y = toMinutes(b);
  const d = Math.abs(x - y);
  return Math.min(d, 24 * 60 - d);
}

export function computeSleepDailySignal(args: {
  target: SleepTargetPayload;
  bedTime: string | null;
  wakeTime: string | null;
}): ProgramAdherenceSignal {
  if (!args.bedTime || !args.wakeTime) {
    return 'na';
  }
  const bedDelta = circularMinuteDelta(args.bedTime, args.target.bedTime);
  const wakeDelta = circularMinuteDelta(args.wakeTime, args.target.wakeTime);

  return bedDelta <= args.target.toleranceMinutes && wakeDelta <= args.target.toleranceMinutes
    ? 'hit'
    : 'miss';
}
