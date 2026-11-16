import type { MedicationClassType } from '@/models/Schema';
import { and, eq, gte, lt } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { acuteDosesSchema, MedicationClass, userMedicationsSchema } from '@/models/Schema';

export type MohStatusLevel = 'ok' | 'approaching' | 'exceeded';

export type MohClassCounter = {
  medicationClass: MedicationClassType;
  rolling30DaysUsed: number;
  calendarMonthDaysUsed: number;
  threshold: number;
  status: MohStatusLevel;
};

export type MohStatusResult = {
  timezone: string;
  asOf: string;
  rollingWindowDays: number;
  perClass: MohClassCounter[];
  multiClass: {
    rolling30DaysUsed: number;
    calendarMonthDaysUsed: number;
    threshold: number;
    status: MohStatusLevel;
  };
  status: MohStatusLevel;
  message: string;
};

export type MohDoseEvent = {
  medicationClass: MedicationClassType;
  takenAt: Date;
};

const CLASS_THRESHOLDS: Record<MedicationClassType, number> = {
  [MedicationClass.TRIPTAN]: 10,
  [MedicationClass.ERGOTAMINE]: 10,
  [MedicationClass.COMBINATION_ANALGESIC]: 10,
  [MedicationClass.OPIOID]: 10,
  [MedicationClass.NON_OPIOID_SIMPLE_ANALGESIC]: 15,
};

function toStatus(usedDays: number, threshold: number): MohStatusLevel {
  if (usedDays >= threshold) {
    return 'exceeded';
  }
  if (usedDays >= threshold * 0.8) {
    return 'approaching';
  }
  return 'ok';
}

function highestStatus(levels: MohStatusLevel[]): MohStatusLevel {
  if (levels.includes('exceeded')) {
    return 'exceeded';
  }
  if (levels.includes('approaching')) {
    return 'approaching';
  }
  return 'ok';
}

function riskCopy(): string {
  return 'Acute medication use may increase risk of medication-overuse headache; discuss with your clinician.';
}

export async function getMOHStatus(
  userId: string,
  now: Date,
  windowDays = 30,
): Promise<MohStatusResult> {
  const timezone = 'Europe/Berlin';
  const nowLocal = DateTime.fromJSDate(now, { zone: timezone });
  const rollingStartUtc = nowLocal
    .startOf('day')
    .minus({ days: Math.max(1, windowDays) - 1 })
    .toUTC()
    .toJSDate();
  const monthStartUtc = nowLocal.startOf('month').toUTC().toJSDate();
  const monthEndUtcExclusive = nowLocal.endOf('month').plus({ milliseconds: 1 }).toUTC().toJSDate();
  const queryStart = rollingStartUtc < monthStartUtc ? rollingStartUtc : monthStartUtc;
  const queryEnd = monthEndUtcExclusive;

  const doseRows = await db
    .select({
      takenAt: acuteDosesSchema.takenAt,
      medicationClass: userMedicationsSchema.medicationClass,
    })
    .from(acuteDosesSchema)
    .innerJoin(
      userMedicationsSchema,
      eq(acuteDosesSchema.medicationId, userMedicationsSchema.id),
    )
    .where(
      and(
        eq(acuteDosesSchema.userId, userId),
        eq(userMedicationsSchema.isAcute, true),
        gte(acuteDosesSchema.takenAt, queryStart),
        lt(acuteDosesSchema.takenAt, queryEnd),
      ),
    );

  return computeMohStatusFromEvents({
    events: doseRows as MohDoseEvent[],
    now,
    timezone,
    windowDays,
  });
}

export function computeMohStatusFromEvents(args: {
  events: MohDoseEvent[];
  now: Date;
  timezone: string;
  windowDays?: number;
}): MohStatusResult {
  const windowDays = args.windowDays ?? 30;
  const nowLocal = DateTime.fromJSDate(args.now, { zone: args.timezone });
  const rollingByClass = new Map<MedicationClassType, Set<string>>();
  const monthByClass = new Map<MedicationClassType, Set<string>>();
  const rollingMulti = new Set<string>();
  const monthMulti = new Set<string>();

  for (const cls of Object.values(MedicationClass)) {
    rollingByClass.set(cls, new Set<string>());
    monthByClass.set(cls, new Set<string>());
  }

  const rollingStartLocalDate = nowLocal
    .startOf('day')
    .minus({ days: Math.max(1, windowDays) - 1 })
    .toISODate()!;
  const monthStartLocalDate = nowLocal.startOf('month').toISODate()!;
  const monthEndLocalDate = nowLocal.endOf('month').toISODate()!;

  for (const row of args.events) {
    const localDate = DateTime.fromJSDate(row.takenAt, { zone: args.timezone }).toISODate();
    if (!localDate) {
      continue;
    }

    if (localDate >= rollingStartLocalDate && localDate <= nowLocal.toISODate()!) {
      rollingByClass.get(row.medicationClass)?.add(localDate);
      rollingMulti.add(localDate);
    }
    if (localDate >= monthStartLocalDate && localDate <= monthEndLocalDate) {
      monthByClass.get(row.medicationClass)?.add(localDate);
      monthMulti.add(localDate);
    }
  }

  const perClass: MohClassCounter[] = Object.values(MedicationClass).map((medicationClass) => {
    const rolling30DaysUsed = rollingByClass.get(medicationClass)?.size ?? 0;
    const calendarMonthDaysUsed = monthByClass.get(medicationClass)?.size ?? 0;
    const threshold = CLASS_THRESHOLDS[medicationClass];
    const status = highestStatus([
      toStatus(rolling30DaysUsed, threshold),
      toStatus(calendarMonthDaysUsed, threshold),
    ]);
    return {
      medicationClass,
      rolling30DaysUsed,
      calendarMonthDaysUsed,
      threshold,
      status,
    };
  });

  const multiClassThreshold = 10;
  const multiClassStatus = highestStatus([
    toStatus(rollingMulti.size, multiClassThreshold),
    toStatus(monthMulti.size, multiClassThreshold),
  ]);
  const status = highestStatus([...perClass.map(c => c.status), multiClassStatus]);

  return {
    timezone: args.timezone,
    asOf: nowLocal.toISO() ?? args.now.toISOString(),
    rollingWindowDays: windowDays,
    perClass,
    multiClass: {
      rolling30DaysUsed: rollingMulti.size,
      calendarMonthDaysUsed: monthMulti.size,
      threshold: multiClassThreshold,
      status: multiClassStatus,
    },
    status,
    message: riskCopy(),
  };
}
