import type { CycleFlowType, CycleHormoneProfileType, CyclePrivacyModeType } from '@/models/Schema';
import type { LocalDateString } from '@/services/localDate';

import { and, asc, eq, gte, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  cycleBleedingDaySchema,
  CycleFlow,
  CycleHormoneProfile,
  CyclePrivacyMode,
  cycleSettingsSchema,
  dailyDiaryEntrySchema,
  episodeSchema,
} from '@/models/Schema';
import { buildRelativeAttackHistogram, computeBleedingStartDates, getCycleDay, isInPerimenstrualWindow, normalizeDate as normalizeDomainDate } from '@/services/cycle/cycleDomain';
import { ymdToDbDate } from '@/services/localDate';
import { getUserTimezone } from '@/services/userTimezone';

export type CycleSettingsDTO = {
  enabled: boolean;
  includeInExports: boolean;
  privacyMode: CyclePrivacyModeType;
  perimenstrualWindowStartDays: number;
  perimenstrualWindowEndDays: number;
  hormoneProfile: CycleHormoneProfileType;
  updatedAt: string | null;
};

export type CycleCalendarDayDTO = {
  localDate: string;
  bleeding: boolean;
  flow: CycleFlowType;
};

const defaultCycleSettings: CycleSettingsDTO = {
  enabled: false,
  includeInExports: false,
  privacyMode: CyclePrivacyMode.LOCAL_ONLY,
  perimenstrualWindowStartDays: -2,
  perimenstrualWindowEndDays: 3,
  hormoneProfile: CycleHormoneProfile.UNKNOWN,
  updatedAt: null,
};

function toIsoOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function ensureWindowRange(start: number, end: number) {
  if (start < -5 || start > 0) {
    throw new Error('Window start must be between -5 and 0');
  }
  if (end < 0 || end > 7) {
    throw new Error('Window end must be between 0 and 7');
  }
  if (start > end) {
    throw new Error('Window start must be <= window end');
  }
}

function nearestStartDate(date: string, startDates: string[]): string | null {
  if (startDates.length === 0) {
    return null;
  }
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const start of startDates) {
    const delta = Math.abs(
      DateTime.fromISO(date, { zone: 'UTC' }).diff(DateTime.fromISO(start, { zone: 'UTC' }), 'days').days,
    );
    if (delta < bestDistance) {
      bestDistance = delta;
      best = start;
    }
  }
  return best;
}

export class CycleService {
  async getSettings(userId: string): Promise<CycleSettingsDTO> {
    const [row] = await db
      .select()
      .from(cycleSettingsSchema)
      .where(eq(cycleSettingsSchema.userId, userId))
      .limit(1);

    if (!row) {
      return defaultCycleSettings;
    }

    return {
      enabled: row.enabled,
      includeInExports: row.includeInExports,
      privacyMode: row.privacyMode,
      perimenstrualWindowStartDays: row.perimenstrualWindowStartDays,
      perimenstrualWindowEndDays: row.perimenstrualWindowEndDays,
      hormoneProfile: row.hormoneProfile,
      updatedAt: toIsoOrNull(row.updatedAt),
    };
  }

  async upsertSettings(args: {
    userId: string;
    patch: Partial<{
      enabled: boolean;
      includeInExports: boolean;
      privacyMode: CyclePrivacyModeType;
      perimenstrualWindowStartDays: number;
      perimenstrualWindowEndDays: number;
      hormoneProfile: CycleHormoneProfileType;
    }>;
  }): Promise<CycleSettingsDTO> {
    const existing = await this.getSettings(args.userId);
    const next: CycleSettingsDTO = {
      enabled: args.patch.enabled ?? existing.enabled,
      includeInExports: args.patch.includeInExports ?? existing.includeInExports,
      privacyMode: args.patch.privacyMode ?? existing.privacyMode,
      perimenstrualWindowStartDays: args.patch.perimenstrualWindowStartDays ?? existing.perimenstrualWindowStartDays,
      perimenstrualWindowEndDays: args.patch.perimenstrualWindowEndDays ?? existing.perimenstrualWindowEndDays,
      hormoneProfile: args.patch.hormoneProfile ?? existing.hormoneProfile,
      updatedAt: null,
    };

    ensureWindowRange(next.perimenstrualWindowStartDays, next.perimenstrualWindowEndDays);

    const [saved] = await db
      .insert(cycleSettingsSchema)
      .values({
        userId: args.userId,
        enabled: next.enabled,
        includeInExports: next.includeInExports,
        privacyMode: next.privacyMode,
        perimenstrualWindowStartDays: next.perimenstrualWindowStartDays,
        perimenstrualWindowEndDays: next.perimenstrualWindowEndDays,
        hormoneProfile: next.hormoneProfile,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [cycleSettingsSchema.userId],
        set: {
          enabled: next.enabled,
          includeInExports: next.includeInExports,
          privacyMode: next.privacyMode,
          perimenstrualWindowStartDays: next.perimenstrualWindowStartDays,
          perimenstrualWindowEndDays: next.perimenstrualWindowEndDays,
          hormoneProfile: next.hormoneProfile,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      ...next,
      updatedAt: toIsoOrNull(saved?.updatedAt),
    };
  }

  async getBleedingDay(args: { userId: string; localDate: string }): Promise<CycleCalendarDayDTO | null> {
    const localDate = normalizeDomainDate(args.localDate);
    const [row] = await db
      .select()
      .from(cycleBleedingDaySchema)
      .where(
        and(
          eq(cycleBleedingDaySchema.userId, args.userId),
          eq(cycleBleedingDaySchema.localDate, ymdToDbDate(localDate as LocalDateString)),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      localDate,
      bleeding: row.bleeding,
      flow: row.flow,
    };
  }

  async setBleedingDay(args: {
    userId: string;
    localDate: string;
    bleeding: boolean;
    flow?: CycleFlowType;
  }): Promise<CycleCalendarDayDTO> {
    const localDate = normalizeDomainDate(args.localDate);
    const flow = args.flow ?? CycleFlow.UNSPECIFIED;

    const [saved] = await db
      .insert(cycleBleedingDaySchema)
      .values({
        userId: args.userId,
        localDate: ymdToDbDate(localDate as LocalDateString),
        bleeding: args.bleeding,
        flow,
        source: 'user',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [cycleBleedingDaySchema.userId, cycleBleedingDaySchema.localDate],
        set: {
          bleeding: args.bleeding,
          flow,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      localDate,
      bleeding: saved?.bleeding ?? args.bleeding,
      flow: (saved?.flow ?? flow) as CycleFlowType,
    };
  }

  async toggleBleedingDay(args: { userId: string; localDate: string }): Promise<CycleCalendarDayDTO> {
    const existing = await this.getBleedingDay(args);
    return this.setBleedingDay({
      userId: args.userId,
      localDate: args.localDate,
      bleeding: !(existing?.bleeding ?? false),
      flow: existing?.flow ?? CycleFlow.UNSPECIFIED,
    });
  }

  async setFlow(args: { userId: string; localDate: string; flow: CycleFlowType }): Promise<CycleCalendarDayDTO> {
    const existing = await this.getBleedingDay(args);
    return this.setBleedingDay({
      userId: args.userId,
      localDate: args.localDate,
      bleeding: existing?.bleeding ?? true,
      flow: args.flow,
    });
  }

  async deleteBleedingDay(args: { userId: string; localDate: string }): Promise<void> {
    const localDate = normalizeDomainDate(args.localDate);
    await db
      .delete(cycleBleedingDaySchema)
      .where(
        and(
          eq(cycleBleedingDaySchema.userId, args.userId),
          eq(cycleBleedingDaySchema.localDate, ymdToDbDate(localDate as LocalDateString)),
        ),
      );
  }

  async getCalendarRange(args: {
    userId: string;
    from: string;
    to: string;
  }): Promise<{
    timezone: string;
    from: string;
    to: string;
    days: CycleCalendarDayDTO[];
    bleedingStartDates: string[];
    migraineDays: string[];
  }> {
    const from = normalizeDomainDate(args.from);
    const to = normalizeDomainDate(args.to);
    const timezone = await getUserTimezone(args.userId);

    const [days, migraineRows] = await Promise.all([
      db
        .select()
        .from(cycleBleedingDaySchema)
        .where(
          and(
            eq(cycleBleedingDaySchema.userId, args.userId),
            gte(cycleBleedingDaySchema.localDate, ymdToDbDate(from as LocalDateString)),
            lte(cycleBleedingDaySchema.localDate, ymdToDbDate(to as LocalDateString)),
          ),
        )
        .orderBy(asc(cycleBleedingDaySchema.localDate)),
      db
        .select({
          localDate: dailyDiaryEntrySchema.localDate,
        })
        .from(dailyDiaryEntrySchema)
        .where(
          and(
            eq(dailyDiaryEntrySchema.userId, args.userId),
            eq(dailyDiaryEntrySchema.dayType, 'migraine_day'),
            gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(from as LocalDateString)),
            lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(to as LocalDateString)),
          ),
        ),
    ]);

    const dayDtos = days.map(day => ({
      localDate: DateTime.fromJSDate(day.localDate, { zone: 'UTC' }).toISODate()!,
      bleeding: day.bleeding,
      flow: day.flow,
    }));
    const bleedingStartDates = computeBleedingStartDates(
      new Set(dayDtos.filter(d => d.bleeding).map(d => d.localDate)),
    );

    const migraineDays = migraineRows
      .map(row => DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!)
      .sort((a, b) => a.localeCompare(b));

    return {
      timezone,
      from,
      to,
      days: dayDtos,
      bleedingStartDates,
      migraineDays,
    };
  }

  async getContextForDate(args: {
    userId: string;
    date: string;
  }): Promise<{
    date: string;
    enabled: boolean;
    cycleDay: number | null;
    relativeDay: number | null;
    withinPerimenstrualWindow: boolean;
    anchorBleedStartDate: string | null;
  }> {
    const date = normalizeDomainDate(args.date);
    const settings = await this.getSettings(args.userId);
    const startDates = await this.getBleedingStartDates(args.userId);
    const anchorStart = nearestStartDate(date, startDates);
    const cycleDay = getCycleDay(date, (() => {
      const sorted = [...startDates].sort((a, b) => a.localeCompare(b));
      let last: string | null = null;
      for (const start of sorted) {
        if (start <= date) {
          last = start;
        } else {
          break;
        }
      }
      return last;
    })());
    const relativeDay = anchorStart
      ? Math.round(DateTime.fromISO(date).diff(DateTime.fromISO(anchorStart), 'days').days)
      : null;

    return {
      date,
      enabled: settings.enabled,
      cycleDay,
      relativeDay,
      withinPerimenstrualWindow: isInPerimenstrualWindow(
        date,
        anchorStart,
        settings.perimenstrualWindowStartDays,
        settings.perimenstrualWindowEndDays,
      ),
      anchorBleedStartDate: anchorStart,
    };
  }

  async getInsights(args: {
    userId: string;
    from: string;
    to: string;
  }): Promise<{
    enabled: boolean;
    hasEnoughData: boolean;
    totalAttacks: number;
    attacksInWindow: number;
    attacksOutOfWindow: number;
    inWindowPct: number | null;
    rangeStart: number;
    rangeEnd: number;
    histogram: Array<{ relativeDay: number; count: number }>;
    bleedingStartCount: number;
  }> {
    const from = normalizeDomainDate(args.from);
    const to = normalizeDomainDate(args.to);
    const timezone = await getUserTimezone(args.userId);
    const settings = await this.getSettings(args.userId);
    const startDates = await this.getBleedingStartDates(args.userId);

    const rangeStartUtc = DateTime.fromISO(from, { zone: timezone }).startOf('day').toUTC().toJSDate();
    const rangeEndExclusiveUtc = DateTime.fromISO(to, { zone: timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const attacks = await db
      .select({ startTime: episodeSchema.startTime })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          eq(episodeSchema.attackType, 'migraine'),
          gte(episodeSchema.startTime, rangeStartUtc),
          lt(episodeSchema.startTime, rangeEndExclusiveUtc),
        ),
      );

    const attackDates = attacks
      .map(a => DateTime.fromJSDate(a.startTime, { zone: timezone }).toISODate()!)
      .sort((a, b) => a.localeCompare(b));

    let attacksInWindow = 0;
    for (const attackDate of attackDates) {
      const anchorStart = nearestStartDate(attackDate, startDates);
      if (isInPerimenstrualWindow(
        attackDate,
        anchorStart,
        settings.perimenstrualWindowStartDays,
        settings.perimenstrualWindowEndDays,
      )) {
        attacksInWindow += 1;
      }
    }

    const histogramMap = buildRelativeAttackHistogram(attackDates, startDates, -5, 7);
    const histogram = [...histogramMap.entries()].map(([relativeDay, count]) => ({ relativeDay, count }));

    const totalAttacks = attackDates.length;
    const attacksOutOfWindow = Math.max(0, totalAttacks - attacksInWindow);

    return {
      enabled: settings.enabled,
      hasEnoughData: startDates.length >= 2,
      totalAttacks,
      attacksInWindow,
      attacksOutOfWindow,
      inWindowPct: totalAttacks > 0 ? attacksInWindow / totalAttacks : null,
      rangeStart: settings.perimenstrualWindowStartDays,
      rangeEnd: settings.perimenstrualWindowEndDays,
      histogram,
      bleedingStartCount: startDates.length,
    };
  }

  async getBleedingStartDates(userId: string): Promise<string[]> {
    const rows = await db
      .select({
        localDate: cycleBleedingDaySchema.localDate,
      })
      .from(cycleBleedingDaySchema)
      .where(
        and(
          eq(cycleBleedingDaySchema.userId, userId),
          eq(cycleBleedingDaySchema.bleeding, true),
        ),
      )
      .orderBy(asc(cycleBleedingDaySchema.localDate));

    const bleedingDays = new Set(
      rows.map(row => DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!),
    );
    return computeBleedingStartDates(bleedingDays);
  }

  async deleteAllData(userId: string): Promise<void> {
    await db.delete(cycleBleedingDaySchema).where(eq(cycleBleedingDaySchema.userId, userId));
    await db.delete(cycleSettingsSchema).where(eq(cycleSettingsSchema.userId, userId));
  }
}

export const cycleService = new CycleService();
