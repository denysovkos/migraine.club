import type { FactorTypeType } from '@/models/Schema';
import type { BuiltInFactor } from '@/services/factors/factorCatalog';

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { factorEventSchema, factorSchema, FactorType } from '@/models/Schema';
import { getBuiltInFactorsByType } from '@/services/factors/factorCatalog';
import { getUserTimezone } from '@/services/userTimezone';

type FactorOptionType = Extract<FactorTypeType, 'trigger' | 'protector'>;

type RecentFactor = Readonly<{
  factorId: string;
  displayName: string;
  type: FactorOptionType;
  key: string | null;
}>;

type RecentFactorRow = Readonly<{
  factorId: string;
  displayName: string;
  type: FactorTypeType;
  key: string | null;
  lastOccurredAt: Date;
}>;

type BuiltInFactorOption = BuiltInFactor & Readonly<{ logged: boolean }>;

export type FactorOptionsResponse = Readonly<{
  trigger: {
    builtIns: BuiltInFactorOption[];
    recent: RecentFactor[];
  };
  protector: {
    builtIns: BuiltInFactorOption[];
    recent: RecentFactor[];
  };
}>;

function normalizeFactorToken(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function buildGroup(
  type: FactorOptionType,
  builtIns: BuiltInFactor[],
  recent: RecentFactor[],
  logged: Set<string>,
): FactorOptionsResponse[FactorOptionType] {
  const builtInTokens = new Set(builtIns.map(item => item.key));

  return {
    builtIns: builtIns.map(item => ({
      ...item,
      logged: logged.has(`${item.type}:${item.key}`),
    })),
    recent: recent.filter((item) => {
      if (item.type !== type) {
        return false;
      }

      const recentToken = normalizeFactorToken(item.key) ?? normalizeFactorToken(item.displayName);
      return recentToken === null || !builtInTokens.has(recentToken);
    }),
  };
}

export function mergeFactorOptions(args: {
  builtIns: BuiltInFactor[];
  recent: RecentFactor[];
  logged: Set<string>;
}): FactorOptionsResponse {
  return {
    trigger: buildGroup(FactorType.TRIGGER, args.builtIns.filter(item => item.type === FactorType.TRIGGER), args.recent, args.logged),
    protector: buildGroup(
      FactorType.PROTECTOR,
      args.builtIns.filter(item => item.type === FactorType.PROTECTOR),
      args.recent,
      args.logged,
    ),
  };
}

export function buildRecentFactors(rows: RecentFactorRow[]): RecentFactor[] {
  const seen = new Set<string>();
  const recent: RecentFactor[] = [];

  for (const row of rows) {
    if (row.type !== FactorType.TRIGGER && row.type !== FactorType.PROTECTOR) {
      continue;
    }

    if (seen.has(row.factorId)) {
      continue;
    }

    seen.add(row.factorId);
    recent.push({
      factorId: row.factorId,
      displayName: row.displayName,
      type: row.type,
      key: row.key,
    });
  }

  return recent;
}

export class FactorOptionsService {
  async getOptions(args: { userId: string; localDate?: string }): Promise<FactorOptionsResponse> {
    const timezone = await getUserTimezone(args.userId);
    const targetLocalDate = this.resolveLocalDate(args.localDate, timezone);
    const dayStartUtc = DateTime.fromISO(targetLocalDate, { zone: timezone }).startOf('day').toUTC().toJSDate();
    const dayEndExclusiveUtc = DateTime.fromISO(targetLocalDate, { zone: timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const recentFactorsQuery = db
      .select({
        factorId: factorEventSchema.factorId,
        lastOccurredAt: sql<Date>`max(${factorEventSchema.occurredAt})`.as('last_occurred_at'),
      })
      .from(factorEventSchema)
      .where(eq(factorEventSchema.userId, args.userId))
      .groupBy(factorEventSchema.factorId)
      .as('recent_factors');

    const [recentRows, loggedRows] = await Promise.all([
      db
        .select({
          factorId: factorSchema.id,
          displayName: factorSchema.displayName,
          type: factorSchema.type,
          key: factorSchema.key,
          lastOccurredAt: recentFactorsQuery.lastOccurredAt,
        })
        .from(factorSchema)
        .innerJoin(recentFactorsQuery, eq(factorSchema.id, recentFactorsQuery.factorId))
        .where(
          and(
            eq(factorSchema.userId, args.userId),
            inArray(factorSchema.type, [FactorType.TRIGGER, FactorType.PROTECTOR]),
          ),
        )
        .orderBy(desc(recentFactorsQuery.lastOccurredAt))
        .limit(25),
      db
        .select({
          type: factorSchema.type,
          key: factorSchema.key,
          displayName: factorSchema.displayName,
        })
        .from(factorEventSchema)
        .innerJoin(factorSchema, eq(factorEventSchema.factorId, factorSchema.id))
        .where(
          and(
            eq(factorEventSchema.userId, args.userId),
            eq(factorSchema.userId, args.userId),
            inArray(factorSchema.type, [FactorType.TRIGGER, FactorType.PROTECTOR]),
            gte(factorEventSchema.occurredAt, dayStartUtc),
            lt(factorEventSchema.occurredAt, dayEndExclusiveUtc),
          ),
        ),
    ]);

    const recent = buildRecentFactors(recentRows);
    const logged = new Set(
      loggedRows.flatMap((row) => {
        const token = normalizeFactorToken(row.key) ?? normalizeFactorToken(row.displayName);
        return token ? [`${row.type}:${token}`] : [];
      }),
    );

    return mergeFactorOptions({
      builtIns: [
        ...getBuiltInFactorsByType(FactorType.TRIGGER),
        ...getBuiltInFactorsByType(FactorType.PROTECTOR),
      ],
      recent,
      logged,
    });
  }

  private resolveLocalDate(localDate: string | undefined, timezone: string): string {
    if (localDate) {
      const parsed = DateTime.fromISO(localDate, { zone: timezone });
      if (!parsed.isValid) {
        throw new Error('Invalid localDate');
      }

      return localDate;
    }

    return DateTime.now().setZone(timezone).toISODate()!;
  }
}

export const factorOptionsService = new FactorOptionsService();
