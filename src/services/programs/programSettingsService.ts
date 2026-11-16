import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { programSettingsSchema } from '@/models/Schema';

export type ProgramNotificationsConfig = {
  windDown?: boolean;
  morningCheckIn?: boolean;
  onsetNudge?: boolean;
  weeklyDigest?: boolean;
};

export type ProgramSettingsDTO = {
  enabled: boolean;
  notificationsConfig: ProgramNotificationsConfig;
  updatedAt: string | null;
};

const defaults: ProgramSettingsDTO = {
  enabled: false,
  notificationsConfig: {},
  updatedAt: null,
};

async function get(userId: string): Promise<ProgramSettingsDTO> {
  const [row] = await db
    .select()
    .from(programSettingsSchema)
    .where(eq(programSettingsSchema.userId, userId))
    .limit(1);

  if (!row) {
    return defaults;
  }

  return {
    enabled: row.enabled,
    notificationsConfig: row.notificationsConfig ?? {},
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function update(
  userId: string,
  patch: Partial<Pick<ProgramSettingsDTO, 'enabled' | 'notificationsConfig'>>,
): Promise<ProgramSettingsDTO> {
  const current = await get(userId);
  const next = {
    enabled: patch.enabled ?? current.enabled,
    notificationsConfig: { ...current.notificationsConfig, ...(patch.notificationsConfig ?? {}) },
  };

  await db
    .insert(programSettingsSchema)
    .values({
      userId,
      enabled: next.enabled,
      notificationsConfig: next.notificationsConfig,
    })
    .onConflictDoUpdate({
      target: programSettingsSchema.userId,
      set: {
        enabled: next.enabled,
        notificationsConfig: next.notificationsConfig,
      },
    });

  return get(userId);
}

export const programSettingsService = { get, update };
