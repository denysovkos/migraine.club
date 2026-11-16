import type { PreventiveSchedulePlan } from './schedule';

import { describe, expect, it, vi } from 'vitest';

import { PreventivePlanKind, PreventiveScheduleType } from '@/types/Preventives';
import { getDueStatus, isDueOnDate, PREVENTIVE_FORGIVENESS_DAYS } from './schedule';

vi.mock('@/libs/Logger', () => ({ logger: { warn: vi.fn() } }));

const timezone = 'Europe/Berlin';

function basePlan(overrides: Partial<PreventiveSchedulePlan> = {}): PreventiveSchedulePlan {
  return {
    id: 'plan-1',
    kind: PreventivePlanKind.ORAL,
    scheduleType: PreventiveScheduleType.DAILY,
    schedulePayload: null,
    startDate: '2025-01-01' as const,
    status: 'active',
    ...overrides,
  };
}

describe('preventive schedule rules', () => {
  it('daily is due every day after start date', () => {
    expect(isDueOnDate({ plan: basePlan(), localDate: '2025-01-01', timezone })).toBe(true);
    expect(isDueOnDate({ plan: basePlan(), localDate: '2025-01-02', timezone })).toBe(true);
    expect(isDueOnDate({ plan: basePlan(), localDate: '2024-12-31', timezone })).toBe(false);
  });

  it('weekdays excludes weekends', () => {
    const plan = basePlan({ scheduleType: PreventiveScheduleType.WEEKDAYS });

    expect(isDueOnDate({ plan, localDate: '2025-01-03', timezone })).toBe(true); // Fri
    expect(isDueOnDate({ plan, localDate: '2025-01-04', timezone })).toBe(false); // Sat
  });

  it('custom weekdays uses payload list', () => {
    const plan = basePlan({ scheduleType: PreventiveScheduleType.CUSTOM_WEEKDAYS, schedulePayload: [1, 3, 5] });

    expect(isDueOnDate({ plan, localDate: '2025-01-06', timezone })).toBe(true); // Mon
    expect(isDueOnDate({ plan, localDate: '2025-01-07', timezone })).toBe(false); // Tue
  });

  it('every_n_days uses n offset from start date', () => {
    const plan = basePlan({ scheduleType: PreventiveScheduleType.EVERY_N_DAYS, schedulePayload: { n: 2 } });

    expect(isDueOnDate({ plan, localDate: '2025-01-01', timezone })).toBe(true);
    expect(isDueOnDate({ plan, localDate: '2025-01-02', timezone })).toBe(false);
    expect(isDueOnDate({ plan, localDate: '2025-01-03', timezone })).toBe(true);
  });

  it('every_n_weeks is due on the start weekday', () => {
    const plan = basePlan({ scheduleType: PreventiveScheduleType.EVERY_N_WEEKS, schedulePayload: { n: 2 } });

    expect(isDueOnDate({ plan, localDate: '2025-01-01', timezone })).toBe(true); // Wed
    expect(isDueOnDate({ plan, localDate: '2025-01-08', timezone })).toBe(false);
    expect(isDueOnDate({ plan, localDate: '2025-01-15', timezone })).toBe(true);
  });

  it('on_specific_dates matches exact dates', () => {
    const plan = basePlan({
      scheduleType: PreventiveScheduleType.ON_SPECIFIC_DATES,
      schedulePayload: ['2025-01-02', '2025-01-10'],
    });

    expect(isDueOnDate({ plan, localDate: '2025-01-02', timezone })).toBe(true);
    expect(isDueOnDate({ plan, localDate: '2025-01-03', timezone })).toBe(false);
  });
});

describe('forgiveness window for injections', () => {
  it('treats every_n_weeks injection as due within window', () => {
    const plan = basePlan({
      kind: PreventivePlanKind.INJECTION,
      scheduleType: PreventiveScheduleType.EVERY_N_WEEKS,
      schedulePayload: { n: 4 },
    });
    const due = getDueStatus({
      plan,
      localDate: '2025-01-02',
      timezone,
      events: [],
    });

    expect(due.isDue).toBe(true);
  });

  it('marks overdue only after window ends', () => {
    const plan = basePlan({
      kind: PreventivePlanKind.INFUSION,
      scheduleType: PreventiveScheduleType.EVERY_N_WEEKS,
      schedulePayload: { n: 4 },
    });
    const dayAfterWindow = '2025-01-05';
    const due = getDueStatus({
      plan,
      localDate: dayAfterWindow,
      timezone,
      events: [],
    });

    expect(PREVENTIVE_FORGIVENESS_DAYS).toBe(3);
    expect(due.isOverdue).toBe(true);
  });
});
