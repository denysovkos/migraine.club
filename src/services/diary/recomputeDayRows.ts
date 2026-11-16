import type { DiaryDayCreatedFrom, DiaryDayType } from './attackDayDerivation';
import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { dailyDiaryEntrySchema, episodeSchema } from '@/models/Schema';
import { ymdToDbDate } from '@/services/localDate';

import { getUserTimezone } from '@/services/userTimezone';
import {
  deriveTouchedLocalDatesForEpisode,
  strongestDayTypeFromAttacks,
  toUtcRangeForLocalDatesInclusive,
} from './attackDayDerivation';

export type RecomputeResult = {
  timezone: string;
  affectedDates: string[];
};

function uniqSorted(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

export async function recomputeDayRowsForDates(args: {
  userId: string;
  localDates: string[]; // YYYY-MM-DD
  timezone?: string;
  now?: Date;
}): Promise<RecomputeResult> {
  const timezone = args.timezone ?? await getUserTimezone(args.userId);
  const now = args.now ?? new Date();
  const localDates = uniqSorted(args.localDates.filter(Boolean));
  if (localDates.length === 0) {
    return { timezone, affectedDates: [] };
  }

  const { rangeStartUtc, rangeEndExclusiveUtc } = toUtcRangeForLocalDatesInclusive({
    timezone,
    localDates,
  });

  const episodes = await db
    .select({
      id: episodeSchema.id,
      startTime: episodeSchema.startTime,
      endTime: episodeSchema.endTime,
      isOngoing: episodeSchema.isOngoing,
      attackType: episodeSchema.attackType,
    })
    .from(episodeSchema)
    .where(
      and(
        eq(episodeSchema.userId, args.userId),
        lt(episodeSchema.startTime, rangeEndExclusiveUtc),
        or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, rangeStartUtc)),
      ),
    );

  // For each date, track whether any migraine/headache attack touches it.
  const flags = new Map<string, { migraine: boolean; headache: boolean }>();
  for (const d of localDates) {
    flags.set(d, { migraine: false, headache: false });
  }

  for (const ep of episodes) {
    const touched = deriveTouchedLocalDatesForEpisode({
      startTime: ep.startTime,
      endTime: ep.endTime,
      isOngoing: ep.isOngoing,
      now,
      timezone,
    });
    for (const d of touched) {
      const f = flags.get(d);
      if (!f) {
        continue;
      } // outside requested set
      // Backward compatibility: if attackType is missing/null, treat as migraine.
      const attackType: 'migraine' | 'headache' = ep.attackType === 'headache' ? 'headache' : 'migraine';
      if (attackType === 'migraine') {
        f.migraine = true;
      } else {
        f.headache = true;
      }
    }
  }

  const existingRows = await db
    .select()
    .from(dailyDiaryEntrySchema)
    .where(
      and(
        eq(dailyDiaryEntrySchema.userId, args.userId),
        inArray(dailyDiaryEntrySchema.localDate, localDates.map(d => ymdToDbDate(d as any))),
      ),
    );

  const existingByDate = new Map<string, typeof dailyDiaryEntrySchema.$inferSelect>();
  for (const row of existingRows) {
    const ymd = DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!;
    existingByDate.set(ymd, row);
  }

  // Apply deterministic dayType rules + createdFrom cleanup rules.
  for (const d of localDates) {
    const f = flags.get(d)!;
    const desired = strongestDayTypeFromAttacks({
      hasMigraineAttack: f.migraine,
      hasHeadacheAttack: f.headache,
    });

    const existing = existingByDate.get(d) ?? null;

    if (desired === 'migraine_day' || desired === 'headache_day') {
      const createdFrom: DiaryDayCreatedFrom
        = (existing?.createdFrom as any) === 'user' ? 'user' : (existing?.createdFrom as any) === 'attack' ? 'attack' : 'attack';

      await db
        .insert(dailyDiaryEntrySchema)
        .values({
          userId: args.userId,
          localDate: ymdToDbDate(d as any),
          timezone,
          dayType: desired as DiaryDayType,
          createdFrom: existing ? (createdFrom as any) : ('attack' as any),
          // Do not overwrite notes/impact; they remain NULL for newly created rows.
          // updatedAt handled by DB default/onUpdate.
          notes: undefined as any,
          impact: undefined as any,
        } as any)
        .onConflictDoUpdate({
          target: [dailyDiaryEntrySchema.userId, dailyDiaryEntrySchema.localDate],
          set: {
            timezone,
            dayType: desired as any,
            // Preserve user provenance if user created the row.
            createdFrom: sql`CASE WHEN ${dailyDiaryEntrySchema.createdFrom} = 'user' THEN 'user' ELSE ${createdFrom} END`,
            updatedAt: new Date(),
          } as any,
        });

      continue;
    }

    // desired === null (no attacks touch the day)
    if (!existing) {
      continue;
    }

    if ((existing.dayType as any) === 'headache_free') {
      // Explicit user headache-free is valid only when no attacks exist: keep.
      continue;
    }

    // If the row only exists because an attack touched it, delete it -> becomes missing.
    if ((existing.createdFrom as any) === 'attack') {
      await db
        .delete(dailyDiaryEntrySchema)
        .where(
          and(
            eq(dailyDiaryEntrySchema.userId, args.userId),
            eq(dailyDiaryEntrySchema.localDate, ymdToDbDate(d as any)),
          ),
        );
      continue;
    }

    // createdFrom=user and no attacks: keep historical user-stated classification.
  }

  return { timezone, affectedDates: localDates };
}
