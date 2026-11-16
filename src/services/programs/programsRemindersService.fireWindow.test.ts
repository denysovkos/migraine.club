import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { isWithinFireWindow } from './programsRemindersService';

const tz = 'Europe/Berlin';

function localAt(hhmm: string): DateTime {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.fromISO('2026-05-05T00:00', { zone: tz }).set({ hour: h, minute: m });
}

describe('isWithinFireWindow', () => {
  it('matches when now equals target with no offset', () => {
    expect(isWithinFireWindow(localAt('07:30'), '07:30', 0)).toBe(true);
  });

  it('matches within ±6 minute window', () => {
    expect(isWithinFireWindow(localAt('07:24'), '07:30', 0)).toBe(true);
    expect(isWithinFireWindow(localAt('07:36'), '07:30', 0)).toBe(true);
  });

  it('rejects outside window', () => {
    expect(isWithinFireWindow(localAt('07:23'), '07:30', 0)).toBe(false);
    expect(isWithinFireWindow(localAt('07:37'), '07:30', 0)).toBe(false);
  });

  it('applies negative offset (wind-down 30 min before bed)', () => {
    // bed time 23:00, wind-down should fire at 22:30
    expect(isWithinFireWindow(localAt('22:30'), '23:00', -30)).toBe(true);
    expect(isWithinFireWindow(localAt('22:00'), '23:00', -30)).toBe(false);
  });

  it('applies positive offset (morning check 30 min after wake)', () => {
    // wake 07:00, morning check fires at 07:30
    expect(isWithinFireWindow(localAt('07:30'), '07:00', 30)).toBe(true);
    expect(isWithinFireWindow(localAt('08:00'), '07:00', 30)).toBe(false);
  });

  it('handles timezone correctly (no UTC drift)', () => {
    const ny = DateTime.fromISO('2026-05-05T07:30', { zone: 'America/New_York' });

    expect(isWithinFireWindow(ny, '07:30', 0)).toBe(true);
  });
});
