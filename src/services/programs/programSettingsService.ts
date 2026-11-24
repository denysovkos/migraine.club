// The program settings the Go server returns from /api/programs/settings.

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
