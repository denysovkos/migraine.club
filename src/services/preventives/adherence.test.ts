import type { PreventiveSchedulePlan } from './schedule';

import { describe, expect, it } from 'vitest';

import { PreventiveIntakeState, PreventivePlanKind, PreventiveScheduleType } from '@/types/Preventives';
import { resolveAdherenceForRange } from './schedule';

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

describe('preventive adherence', () => {
  it('excludes unsure from adherence denominator', () => {
    const plan = basePlan();
    const result = resolveAdherenceForRange({
      plan,
      from: '2025-01-01',
      to: '2025-01-03',
      timezone,
      events: [
        { localDate: '2025-01-01', state: PreventiveIntakeState.TAKEN },
        { localDate: '2025-01-02', state: PreventiveIntakeState.UNSURE },
        { localDate: '2025-01-03', state: PreventiveIntakeState.MISSED },
      ],
    });

    expect(result.taken).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.unsure).toBe(1);
    expect(result.dueDays).toBe(3);
  });

  it('ignores non-due days', () => {
    const plan = basePlan({
      scheduleType: PreventiveScheduleType.CUSTOM_WEEKDAYS,
      schedulePayload: [1], // Mondays only
    });
    const result = resolveAdherenceForRange({
      plan,
      from: '2025-01-01',
      to: '2025-01-07',
      timezone,
      events: [
        { localDate: '2025-01-02', state: PreventiveIntakeState.TAKEN },
        { localDate: '2025-01-06', state: PreventiveIntakeState.TAKEN }, // Monday
      ],
    });

    expect(result.dueDays).toBe(1);
    expect(result.taken).toBe(1);
  });
});
