import type { LocalDateString } from '@/services/localDate';

import type { PreventiveIntakeStateType, PreventivePlanKindType, PreventiveSchedulePayload, PreventiveScheduleTypeType } from '@/types/Preventives';
import { DateTime } from 'luxon';
import { logger } from '@/libs/Logger';
import {
  PreventiveIntakeState,
  PreventivePlanKind,
  PreventiveScheduleType,
} from '@/types/Preventives';

export const PREVENTIVE_FORGIVENESS_DAYS = 3;

export type PreventiveSchedulePlan = {
  id: string;
  kind: PreventivePlanKindType;
  scheduleType: PreventiveScheduleTypeType;
  schedulePayload: PreventiveSchedulePayload;
  startDate: LocalDateString;
  status: 'active' | 'paused' | 'stopped';
};

export type PreventiveIntakeEventLite = {
  localDate: LocalDateString;
  state: PreventiveIntakeStateType;
};

type DueWindow = {
  dueDate: LocalDateString;
  windowStart: LocalDateString;
  windowEnd: LocalDateString;
};

function toDate(ymd: LocalDateString, timezone: string): DateTime {
  return DateTime.fromISO(ymd, { zone: timezone }).startOf('day');
}

function clampLocalDate(date: DateTime): LocalDateString {
  return date.toISODate()! as LocalDateString;
}

function parseWeekdays(payload: PreventiveSchedulePayload): number[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const out = payload.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7);
  return [...new Set(out)];
}

function parseSpecificDates(payload: PreventiveSchedulePayload): LocalDateString[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((v): v is LocalDateString => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

function parseEveryN(payload: PreventiveSchedulePayload): number | null {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    return null;
  }
  const n = (payload as any).n;
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

function sameWeekday(a: DateTime, b: DateTime): boolean {
  return a.weekday === b.weekday;
}

function getEveryNWeeksWindow(args: {
  startDate: LocalDateString;
  localDate: LocalDateString;
  timezone: string;
  n: number;
}): DueWindow | null {
  const { startDate, localDate, timezone, n } = args;
  const start = toDate(startDate, timezone);
  const target = toDate(localDate, timezone);
  if (target < start) {
    return null;
  }
  const diffDays = Math.floor(target.diff(start, 'days').days);
  const weeksDiff = Math.floor(diffDays / 7);
  const kPrev = Math.floor(weeksDiff / n);
  const prevDue = start.plus({ weeks: kPrev * n });
  const nextDue = prevDue.plus({ weeks: n });
  const halfWindow = Math.floor(PREVENTIVE_FORGIVENESS_DAYS / 2);

  const windowFor = (due: DateTime): DueWindow => ({
    dueDate: clampLocalDate(due),
    windowStart: clampLocalDate(due.minus({ days: halfWindow })),
    windowEnd: clampLocalDate(due.plus({ days: halfWindow })),
  });

  const prevWindow = windowFor(prevDue);
  const nextWindow = windowFor(nextDue);

  if (localDate >= prevWindow.windowStart && localDate <= prevWindow.windowEnd) {
    return prevWindow;
  }
  if (localDate >= nextWindow.windowStart && localDate <= nextWindow.windowEnd) {
    return nextWindow;
  }
  return prevWindow;
}

export function scheduleLabel(plan: PreventiveSchedulePlan): string {
  switch (plan.scheduleType) {
    case PreventiveScheduleType.DAILY:
      return 'Daily';
    case PreventiveScheduleType.WEEKDAYS:
      return 'Weekdays';
    case PreventiveScheduleType.CUSTOM_WEEKDAYS: {
      const weekdays = parseWeekdays(plan.schedulePayload);
      if (weekdays.length === 0) {
        return 'Custom days';
      }
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return weekdays.sort().map(d => labels[d - 1] ?? '').filter(Boolean).join(', ');
    }
    case PreventiveScheduleType.EVERY_N_DAYS: {
      const n = parseEveryN(plan.schedulePayload);
      return n ? `Every ${n} days` : 'Every N days';
    }
    case PreventiveScheduleType.EVERY_N_WEEKS: {
      const n = parseEveryN(plan.schedulePayload);
      return n ? `Every ${n} weeks` : 'Every N weeks';
    }
    case PreventiveScheduleType.ON_SPECIFIC_DATES: {
      const dates = parseSpecificDates(plan.schedulePayload);
      return dates.length > 0 ? 'Specific dates' : 'Specific dates';
    }
    default:
      return 'Schedule';
  }
}

export function isDueOnDate(args: {
  plan: PreventiveSchedulePlan;
  localDate: LocalDateString;
  timezone: string;
}): boolean {
  const { plan, localDate, timezone } = args;
  if (localDate < plan.startDate) {
    return false;
  }
  const day = toDate(localDate, timezone);
  const start = toDate(plan.startDate, timezone);
  switch (plan.scheduleType) {
    case PreventiveScheduleType.DAILY:
      return true;
    case PreventiveScheduleType.WEEKDAYS:
      return day.weekday <= 5;
    case PreventiveScheduleType.CUSTOM_WEEKDAYS: {
      const weekdays = parseWeekdays(plan.schedulePayload);
      return weekdays.includes(day.weekday);
    }
    case PreventiveScheduleType.EVERY_N_DAYS: {
      const n = parseEveryN(plan.schedulePayload);
      if (!n) {
        return false;
      }
      const diff = Math.floor(day.diff(start, 'days').days);
      return diff % n === 0;
    }
    case PreventiveScheduleType.EVERY_N_WEEKS: {
      const n = parseEveryN(plan.schedulePayload);
      if (!n || !sameWeekday(day, start)) {
        return false;
      }
      const diff = Math.floor(day.diff(start, 'weeks').weeks);
      return diff % n === 0;
    }
    case PreventiveScheduleType.ON_SPECIFIC_DATES: {
      const dates = parseSpecificDates(plan.schedulePayload);
      return dates.includes(localDate);
    }
    default:
      return false;
  }
}

export function getDueStatus(args: {
  plan: PreventiveSchedulePlan;
  localDate: LocalDateString;
  timezone: string;
  events: PreventiveIntakeEventLite[];
}): {
  isDue: boolean;
  isOverdue: boolean;
  dueLabel: string;
  canLogToday: boolean;
  matchedEvent: PreventiveIntakeEventLite | null;
} {
  const { plan, localDate, timezone, events } = args;
  const canLogToday = plan.status !== 'stopped';
  if (localDate < plan.startDate) {
    return {
      isDue: false,
      isOverdue: false,
      dueLabel: scheduleLabel(plan),
      canLogToday,
      matchedEvent: null,
    };
  }

  try {
    if (
      plan.scheduleType === PreventiveScheduleType.EVERY_N_WEEKS
      && (plan.kind === PreventivePlanKind.INJECTION || plan.kind === PreventivePlanKind.INFUSION)
    ) {
      const n = parseEveryN(plan.schedulePayload);
      if (!n) {
        return {
          isDue: false,
          isOverdue: false,
          dueLabel: scheduleLabel(plan),
          canLogToday,
          matchedEvent: null,
        };
      }
      const window = getEveryNWeeksWindow({
        startDate: plan.startDate,
        localDate,
        timezone,
        n,
      });
      if (!window) {
        return {
          isDue: false,
          isOverdue: false,
          dueLabel: scheduleLabel(plan),
          canLogToday,
          matchedEvent: null,
        };
      }
      const inWindow = localDate >= window.windowStart && localDate <= window.windowEnd;
      const eventInWindow = events.find(e => e.localDate >= window.windowStart && e.localDate <= window.windowEnd) ?? null;
      const overdue = localDate > window.windowEnd && !eventInWindow;

      return {
        isDue: inWindow,
        isOverdue: overdue,
        dueLabel: scheduleLabel(plan),
        canLogToday,
        matchedEvent: eventInWindow,
      };
    }

    const dueToday = isDueOnDate({ plan, localDate, timezone });
    const matchedEvent = events.find(e => e.localDate === localDate) ?? null;
    return {
      isDue: dueToday,
      isOverdue: false,
      dueLabel: scheduleLabel(plan),
      canLogToday,
      matchedEvent,
    };
  } catch (error) {
    logger.warn({ error, planId: plan.id }, 'Preventive schedule computation failed');
    return {
      isDue: false,
      isOverdue: false,
      dueLabel: scheduleLabel(plan),
      canLogToday,
      matchedEvent: null,
    };
  }
}

export function resolveAdherenceForRange(args: {
  plan: PreventiveSchedulePlan;
  from: LocalDateString;
  to: LocalDateString;
  timezone: string;
  events: PreventiveIntakeEventLite[];
}): {
  dueDays: number;
  taken: number;
  missed: number;
  unsure: number;
  coverage: number;
} {
  const { plan, from, to, timezone, events } = args;
  const start = toDate(from, timezone);
  const end = toDate(to, timezone);
  const days: LocalDateString[] = [];
  let cur = start;
  while (cur <= end) {
    days.push(clampLocalDate(cur));
    cur = cur.plus({ days: 1 });
  }

  let dueDays = 0;
  let taken = 0;
  let missed = 0;
  let unsure = 0;

  for (const day of days) {
    if (plan.scheduleType === PreventiveScheduleType.EVERY_N_WEEKS
      && (plan.kind === PreventivePlanKind.INJECTION || plan.kind === PreventivePlanKind.INFUSION)) {
      const n = parseEveryN(plan.schedulePayload);
      if (!n) {
        continue;
      }
      const startDay = toDate(plan.startDate, timezone);
      const curDay = toDate(day, timezone);
      if (curDay < startDay || curDay.weekday !== startDay.weekday) {
        continue;
      }
      const diffWeeks = Math.floor(curDay.diff(startDay, 'weeks').weeks);
      if (diffWeeks % n !== 0) {
        continue;
      }
      dueDays += 1;
      const window = getEveryNWeeksWindow({
        startDate: plan.startDate,
        localDate: day,
        timezone,
        n,
      });
      const event = window
        ? events.find(e => e.localDate >= window.windowStart && e.localDate <= window.windowEnd) ?? null
        : null;
      if (!event) {
        continue;
      }
      if (event.state === PreventiveIntakeState.TAKEN) {
        taken += 1;
      } else if (event.state === PreventiveIntakeState.MISSED) {
        missed += 1;
      } else {
        unsure += 1;
      }
      continue;
    }

    if (!isDueOnDate({ plan, localDate: day, timezone })) {
      continue;
    }
    dueDays += 1;
    const event = events.find(e => e.localDate === day) ?? null;
    if (!event) {
      continue;
    }
    if (event.state === PreventiveIntakeState.TAKEN) {
      taken += 1;
    } else if (event.state === PreventiveIntakeState.MISSED) {
      missed += 1;
    } else {
      unsure += 1;
    }
  }

  const responded = taken + missed + unsure;
  const coverage = dueDays === 0 ? 0 : responded / dueDays;

  return {
    dueDays,
    taken,
    missed,
    unsure,
    coverage,
  };
}
