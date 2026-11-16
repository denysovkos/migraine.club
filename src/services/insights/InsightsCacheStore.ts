import type { InsightsPayload } from './InsightsTypes';

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';

import { insightsCacheSchema } from '@/models/Schema';

export type CachedInsightsRow = typeof insightsCacheSchema.$inferSelect;

export class InsightsCacheStore {
  async getLatest(params: {
    userId: string;
    windowDays: number;
    methodVersion: string;
  }): Promise<CachedInsightsRow | null> {
    const rows = await db
      .select()
      .from(insightsCacheSchema)
      .where(
        and(
          eq(insightsCacheSchema.userId, params.userId),
          eq(insightsCacheSchema.windowDays, params.windowDays),
          eq(insightsCacheSchema.methodVersion, params.methodVersion),
        ),
      )
      .orderBy(desc(insightsCacheSchema.computedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(params: {
    userId: string;
    windowDays: number;
    methodVersion: string;
    payload: InsightsPayload;
    inputStats: unknown;
    computedAt: Date;
  }): Promise<void> {
    await db
      .insert(insightsCacheSchema)
      .values({
        userId: params.userId,
        windowDays: params.windowDays,
        methodVersion: params.methodVersion,
        computedAt: params.computedAt,
        stale: false,
        payloadJson: params.payload as unknown,
        inputStatsJson: params.inputStats,
      })
      .onConflictDoUpdate({
        target: [
          insightsCacheSchema.userId,
          insightsCacheSchema.windowDays,
          insightsCacheSchema.methodVersion,
        ],
        set: {
          computedAt: params.computedAt,
          stale: false,
          payloadJson: params.payload as unknown,
          inputStatsJson: params.inputStats,
        },
      });
  }

  async markStaleForUser(userId: string): Promise<void> {
    await db
      .update(insightsCacheSchema)
      .set({ stale: true })
      .where(eq(insightsCacheSchema.userId, userId));
  }
}

export const insightsCacheStore = new InsightsCacheStore();
