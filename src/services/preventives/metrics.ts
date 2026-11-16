import type { LocalDateString } from '@/services/localDate';

import { DateTime } from 'luxon';

export const BASELINE_DAYS = 28;
export const RAMP_UP_DAYS = 14;
export const EVAL_DAYS = 28;
export const EXTENDED_EVAL_DAYS = 84;

function calcRangeStart(date: LocalDateString, days: number): LocalDateString {
  return DateTime.fromISO(date).minus({ days }).toISODate()! as LocalDateString;
}

function calcRangeEnd(date: LocalDateString, days: number): LocalDateString {
  return DateTime.fromISO(date).plus({ days }).toISODate()! as LocalDateString;
}

export function resolvePlanWindows(args: {
  startDate: LocalDateString;
  timezone: string;
  todayLocalDate: LocalDateString;
}): {
  baselineFrom: LocalDateString;
  baselineTo: LocalDateString;
  evalFrom: LocalDateString;
  evalTo: LocalDateString;
  evalLongTo: LocalDateString;
  evalEnd: LocalDateString;
  evalLongEnd: LocalDateString;
  hasEvalData: boolean;
} {
  const baselineFrom = calcRangeStart(args.startDate, BASELINE_DAYS);
  const baselineTo = calcRangeStart(args.startDate, 1);
  const evalFrom = calcRangeEnd(args.startDate, RAMP_UP_DAYS);
  const evalTo = calcRangeEnd(evalFrom, EVAL_DAYS - 1);
  const evalLongTo = calcRangeEnd(evalFrom, EXTENDED_EVAL_DAYS - 1);

  const evalEnd = args.todayLocalDate < evalTo ? args.todayLocalDate : evalTo;
  const evalLongEnd = args.todayLocalDate < evalLongTo ? args.todayLocalDate : evalLongTo;

  const hasEvalData = DateTime.fromISO(evalEnd, { zone: args.timezone })
    >= DateTime.fromISO(evalFrom, { zone: args.timezone });

  return {
    baselineFrom,
    baselineTo,
    evalFrom,
    evalTo,
    evalLongTo,
    evalEnd,
    evalLongEnd,
    hasEvalData,
  };
}
