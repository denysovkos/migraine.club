import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { userConsentSchema } from '@/models/Schema';

export async function hasHealthDataConsent(userId: string): Promise<boolean> {
  const consents = await db
    .select({ consentType: userConsentSchema.consentType })
    .from(userConsentSchema)
    .where(
      and(
        eq(userConsentSchema.userId, userId),
        isNull(userConsentSchema.withdrawnAt),
      ),
    );

  const types = new Set(consents.map(c => c.consentType));
  return types.has('health_data') && types.has('terms') && types.has('privacy');
}
