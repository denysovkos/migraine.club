import { DateTime } from 'luxon';

import { MedicationClass } from '@/models/Schema';
import { computeMohStatusFromEvents } from '@/services/acuteMedications/moh';

function z(isoLocal: string) {
  return DateTime.fromISO(isoLocal, { zone: 'Europe/Berlin' }).toJSDate();
}

describe('computeMohStatusFromEvents', () => {
  it('should count unique days per class in window', () => {
    const result = computeMohStatusFromEvents({
      timezone: 'Europe/Berlin',
      now: z('2026-02-15T12:00:00'),
      events: [
        { medicationClass: MedicationClass.TRIPTAN, takenAt: z('2026-02-10T08:00:00') },
        { medicationClass: MedicationClass.TRIPTAN, takenAt: z('2026-02-10T20:00:00') },
      ],
    });

    const triptan = result.perClass.find(c => c.medicationClass === MedicationClass.TRIPTAN)!;

    expect(triptan.rolling30DaysUsed).toBe(1);
    expect(triptan.calendarMonthDaysUsed).toBe(1);
  });

  it('should mark approaching and exceeded by thresholds', () => {
    const approaching = computeMohStatusFromEvents({
      timezone: 'Europe/Berlin',
      now: z('2026-02-15T12:00:00'),
      events: Array.from({ length: 8 }, (_, i) => ({
        medicationClass: MedicationClass.TRIPTAN,
        takenAt: z(`2026-02-${String(i + 1).padStart(2, '0')}T08:00:00`),
      })),
    });

    const exceeded = computeMohStatusFromEvents({
      timezone: 'Europe/Berlin',
      now: z('2026-02-15T12:00:00'),
      events: Array.from({ length: 10 }, (_, i) => ({
        medicationClass: MedicationClass.TRIPTAN,
        takenAt: z(`2026-02-${String(i + 1).padStart(2, '0')}T08:00:00`),
      })),
    });

    expect(approaching.perClass.find(c => c.medicationClass === MedicationClass.TRIPTAN)?.status).toBe('approaching');
    expect(exceeded.perClass.find(c => c.medicationClass === MedicationClass.TRIPTAN)?.status).toBe('exceeded');
  });

  it('should apply multi-class combined 10-day rule', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      medicationClass: i % 2 === 0 ? MedicationClass.TRIPTAN : MedicationClass.OPIOID,
      takenAt: z(`2026-02-${String(i + 1).padStart(2, '0')}T08:00:00`),
    }));
    const result = computeMohStatusFromEvents({
      timezone: 'Europe/Berlin',
      now: z('2026-02-20T12:00:00'),
      events,
    });

    expect(result.multiClass.rolling30DaysUsed).toBe(10);
    expect(result.multiClass.status).toBe('exceeded');
  });

  it('should differentiate rolling and calendar counters', () => {
    const result = computeMohStatusFromEvents({
      timezone: 'Europe/Berlin',
      now: z('2026-02-02T12:00:00'),
      events: [
        { medicationClass: MedicationClass.TRIPTAN, takenAt: z('2026-01-01T08:00:00') },
        { medicationClass: MedicationClass.TRIPTAN, takenAt: z('2026-02-01T08:00:00') },
      ],
    });

    const triptan = result.perClass.find(c => c.medicationClass === MedicationClass.TRIPTAN)!;

    expect(triptan.rolling30DaysUsed).toBe(1);
    expect(triptan.calendarMonthDaysUsed).toBe(1);
  });
});
