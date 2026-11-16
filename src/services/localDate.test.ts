import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { EDIT_WINDOW_DAYS, isEditableLocalDate, toLocalDateString } from '@/services/localDate';

describe('localDate helpers', () => {
  it('computes local YYYY-MM-DD across midnight (Europe/Berlin)', () => {
    // 23:30Z on Mar 30 is 00:30 local on Mar 31 (CET->CEST weekend)
    const d = new Date('2024-03-30T23:30:00Z');

    expect(toLocalDateString(d, 'Europe/Berlin')).toBe('2024-03-31');
  });

  it('computes local YYYY-MM-DD across DST end (Europe/Berlin)', () => {
    const d = new Date('2024-10-26T23:30:00Z');

    expect(toLocalDateString(d, 'Europe/Berlin')).toBe('2024-10-27');
  });

  it(`enforces edit window (EDIT_WINDOW_DAYS=${EDIT_WINDOW_DAYS}) in user timezone`, () => {
    const nowUtc = new Date('2026-01-06T12:00:00Z'); // 13:00 in Berlin
    const today = DateTime.fromJSDate(nowUtc, { zone: 'Europe/Berlin' }).startOf('day');
    const earliestEditable = today.minus({ days: EDIT_WINDOW_DAYS - 1 }).toISODate();
    const dayBeforeWindow = today.minus({ days: EDIT_WINDOW_DAYS }).toISODate();

    expect(isEditableLocalDate('2026-01-06' as any, nowUtc, 'Europe/Berlin')).toBe(true);
    expect(isEditableLocalDate(earliestEditable as any, nowUtc, 'Europe/Berlin')).toBe(true);
    expect(isEditableLocalDate(dayBeforeWindow as any, nowUtc, 'Europe/Berlin')).toBe(false);
  });
});
