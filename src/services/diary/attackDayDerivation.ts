import { DateTime } from 'luxon';

import { getLocalDatesOverlappedByRange } from '@/services/outcomes/localDateOverlap';

export type AttackType = 'migraine' | 'headache';
export type DiaryDayType = 'headache_free' | 'headache_day' | 'migraine_day';
export type DiaryDayCreatedFrom = 'user' | 'attack';

export function deriveTouchedLocalDatesForEpisode(args: {
  startTime: Date;
  endTime: Date | null;
  isOngoing: boolean;
  now?: Date;
  timezone: string;
}): Set<string> {
  const end = args.endTime ?? (args.isOngoing ? (args.now ?? new Date()) : null);
  return getLocalDatesOverlappedByRange({ start: args.startTime, end, timezone: args.timezone });
}

export function toUtcRangeForLocalDatesInclusive(args: {
  timezone: string;
  localDates: string[]; // YYYY-MM-DD
}): { rangeStartUtc: Date; rangeEndExclusiveUtc: Date } {
  if (args.localDates.length === 0) {
    throw new Error('localDates cannot be empty');
  }
  const sorted = [...args.localDates].sort();
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const rangeStartUtc = DateTime.fromISO(min, { zone: args.timezone }).startOf('day').toUTC().toJSDate();
  const rangeEndExclusiveUtc = DateTime.fromISO(max, { zone: args.timezone })
    .plus({ days: 1 })
    .startOf('day')
    .toUTC()
    .toJSDate();
  return { rangeStartUtc, rangeEndExclusiveUtc };
}

export function strongestDayTypeFromAttacks(args: {
  hasMigraineAttack: boolean;
  hasHeadacheAttack: boolean;
}): DiaryDayType | null {
  if (args.hasMigraineAttack) {
    return 'migraine_day';
  }
  if (args.hasHeadacheAttack) {
    return 'headache_day';
  }
  return null;
}
