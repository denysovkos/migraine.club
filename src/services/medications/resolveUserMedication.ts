import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { userMedicationsSchema } from '@/models/Schema';
import { quickAddService } from '@/services/QuickAddService';

export class MedicationResolutionError extends Error {
  code = 'MEDICATION_NOT_FOUND' as const;
}

export type ResolvedUserMedication = {
  id: string;
  isAcute: boolean;
};

/**
 * Resolve a free-text medication name to one of the user's medications,
 * creating it when they have not logged it before.
 *
 * New custom medications default to `isAcute: true` (see the column default on
 * `user_medications`), so an unrecognised name counts toward medication-overuse
 * thresholds rather than being silently excluded from them.
 */
export async function resolveUserMedication(
  userId: string,
  args: { medicationName?: string; userMedicationId?: string },
): Promise<ResolvedUserMedication> {
  let id = args.userMedicationId;

  if (!id) {
    if (!args.medicationName) {
      throw new MedicationResolutionError('Either medicationName or userMedicationId is required.');
    }
    id = await quickAddService.ensureUserMedicationForCustom({
      userId,
      customName: args.medicationName,
    });
  }

  const [row] = await db
    .select({ id: userMedicationsSchema.id, isAcute: userMedicationsSchema.isAcute })
    .from(userMedicationsSchema)
    .where(and(eq(userMedicationsSchema.id, id), eq(userMedicationsSchema.userId, userId)))
    .limit(1);

  if (!row) {
    throw new MedicationResolutionError('Medication not found');
  }

  return row;
}
