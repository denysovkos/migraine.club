import { and, eq, gte } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { db } from '@/libs/DB';
import { programRecommendationDismissalSchema } from '@/models/Schema';

const COOLDOWN_DAYS = 7;

export const recommendationDismissalService = {
  async dismiss(userId: string, programId: string): Promise<void> {
    await db
      .insert(programRecommendationDismissalSchema)
      .values({ userId, programId })
      .onConflictDoUpdate({
        target: [
          programRecommendationDismissalSchema.userId,
          programRecommendationDismissalSchema.programId,
        ],
        set: { dismissedAt: new Date() },
      });
  },

  async listActiveDismissals(userId: string): Promise<string[]> {
    const cutoff = DateTime.now().minus({ days: COOLDOWN_DAYS }).toJSDate();
    const rows = await db
      .select({ programId: programRecommendationDismissalSchema.programId })
      .from(programRecommendationDismissalSchema)
      .where(
        and(
          eq(programRecommendationDismissalSchema.userId, userId),
          gte(programRecommendationDismissalSchema.dismissedAt, cutoff),
        ),
      );
    return rows.map(r => r.programId);
  },
};
