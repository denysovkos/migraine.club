import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { dueSlots, isSlotDue, MAX_LATE_MINUTES, reminderBody } from './medicationReminders';

const TIMEZONE = 'Europe/Berlin';

function localAt(hhmm: string): DateTime {
  return DateTime.fromISO(`2026-09-10T${hhmm}:00`, { zone: TIMEZONE });
}

describe('isSlotDue', () => {
  it('fires exactly at the slot', () => {
    expect(isSlotDue({ nowLocal: localAt('08:00'), slot: '08:00' })).toBe(true);
  });

  it('does not fire before the slot', () => {
    expect(isSlotDue({ nowLocal: localAt('07:59'), slot: '08:00' })).toBe(false);
  });

  it('fires on the first tick after a slot that falls between ticks', () => {
    // 30-minute cron: an 08:15 dose is picked up by the 08:30 tick.
    expect(isSlotDue({ nowLocal: localAt('08:30'), slot: '08:15' })).toBe(true);
  });

  it('still fires after a few missed ticks, up to the late window', () => {
    expect(isSlotDue({ nowLocal: localAt('09:30'), slot: '08:00' })).toBe(true);
    expect(isSlotDue({ nowLocal: localAt('09:00').plus({ minutes: MAX_LATE_MINUTES - 60 }), slot: '08:00' })).toBe(true);
  });

  it('drops a slot that is stale, rather than pushing it at the wrong time of day', () => {
    expect(isSlotDue({ nowLocal: localAt('23:00'), slot: '08:00' })).toBe(false);
  });

  it('does not reach back to the previous day', () => {
    expect(isSlotDue({ nowLocal: localAt('00:15'), slot: '23:30' })).toBe(false);
  });

  it('honours an explicit late window', () => {
    expect(isSlotDue({ nowLocal: localAt('08:40'), slot: '08:00', maxLateMinutes: 30 })).toBe(false);
    expect(isSlotDue({ nowLocal: localAt('08:20'), slot: '08:00', maxLateMinutes: 30 })).toBe(true);
  });

  it('ignores a malformed slot instead of throwing', () => {
    expect(isSlotDue({ nowLocal: localAt('08:00'), slot: 'morning' })).toBe(false);
  });
});

describe('dueSlots', () => {
  const slots = ['08:00', '14:00', '20:00'];

  it('returns only the slots that have come due', () => {
    expect(dueSlots({ nowLocal: localAt('14:00'), slots, sentSlots: new Set() })).toEqual(['14:00']);
  });

  it('skips slots already reminded today — a re-run of the same tick sends nothing', () => {
    expect(dueSlots({ nowLocal: localAt('14:00'), slots, sentSlots: new Set(['14:00']) })).toEqual([]);
  });

  it('catches up on an earlier slot that was never sent, while it is still fresh', () => {
    expect(
      dueSlots({ nowLocal: localAt('08:45'), slots: ['08:00', '08:30'], sentSlots: new Set(['08:00']) }),
    ).toEqual(['08:30']);
  });

  it('returns nothing before the first slot of the day', () => {
    expect(dueSlots({ nowLocal: localAt('06:00'), slots, sentSlots: new Set() })).toEqual([]);
  });
});

describe('reminderBody', () => {
  it('leads with the dose when the user recorded one', () => {
    expect(reminderBody({ doseText: '50 mg', slot: '08:00' })).toBe('50 mg · 08:00');
  });

  it('falls back to the scheduled time', () => {
    expect(reminderBody({ doseText: null, slot: '08:00' })).toBe('Scheduled for 08:00');
    expect(reminderBody({ doseText: '   ', slot: '08:00' })).toBe('Scheduled for 08:00');
  });
});
