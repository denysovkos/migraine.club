import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import * as schema from '@migraine/db/schema';

export type ResetTable = { table: PgTable; owner: PgColumn };

/**
 * Every table whose rows belong to a user, with the column naming the owner,
 * children before parents. scripts/e2e-reset.ts wipes these for the mock
 * user; the user row itself goes last.
 */
export const RESET_TABLES: readonly ResetTable[] = [
  { table: schema.programAdherenceEventSchema, owner: schema.programAdherenceEventSchema.userId },
  { table: schema.programRecommendationDismissalSchema, owner: schema.programRecommendationDismissalSchema.userId },
  { table: schema.programNotificationLogSchema, owner: schema.programNotificationLogSchema.userId },
  { table: schema.programEnrollmentSchema, owner: schema.programEnrollmentSchema.userId },
  { table: schema.programSettingsSchema, owner: schema.programSettingsSchema.userId },
  { table: schema.intakeResponseSchema, owner: schema.intakeResponseSchema.userId },
  { table: schema.preventiveReminderLogSchema, owner: schema.preventiveReminderLogSchema.userId },
  { table: schema.preventiveStatusChangeSchema, owner: schema.preventiveStatusChangeSchema.userId },
  { table: schema.preventiveWeeklyCheckInSchema, owner: schema.preventiveWeeklyCheckInSchema.userId },
  { table: schema.preventiveIntakeEventSchema, owner: schema.preventiveIntakeEventSchema.userId },
  { table: schema.preventivePlanSchema, owner: schema.preventivePlanSchema.userId },
  { table: schema.dailyDiaryEntrySchema, owner: schema.dailyDiaryEntrySchema.userId },
  { table: schema.cycleBleedingDaySchema, owner: schema.cycleBleedingDaySchema.userId },
  { table: schema.cycleSettingsSchema, owner: schema.cycleSettingsSchema.userId },
  { table: schema.pushSubscriptionSchema, owner: schema.pushSubscriptionSchema.userId },
  { table: schema.userConsentSchema, owner: schema.userConsentSchema.userId },
  { table: schema.userOutcomeSettingsSchema, owner: schema.userOutcomeSettingsSchema.userId },
  { table: schema.weatherPainIndexSnapshotSchema, owner: schema.weatherPainIndexSnapshotSchema.userId },
  { table: schema.userWeatherSettingsSchema, owner: schema.userWeatherSettingsSchema.userId },
  { table: schema.userMedicationsSchema, owner: schema.userMedicationsSchema.userId },
  { table: schema.medicationIntakesSchema, owner: schema.medicationIntakesSchema.userId },
  { table: schema.doseOutcomesSchema, owner: schema.doseOutcomesSchema.userId },
  { table: schema.acuteDosesSchema, owner: schema.acuteDosesSchema.userId },
  { table: schema.episodePainReadingSchema, owner: schema.episodePainReadingSchema.userId },
  { table: schema.reliefSessionSchema, owner: schema.reliefSessionSchema.userId },
  { table: schema.factorEventSchema, owner: schema.factorEventSchema.userId },
  { table: schema.factorSchema, owner: schema.factorSchema.userId },
  { table: schema.communityVoteSchema, owner: schema.communityVoteSchema.userId },
  { table: schema.communityReportSchema, owner: schema.communityReportSchema.reporterId },
  { table: schema.communityCommentSchema, owner: schema.communityCommentSchema.authorId },
  { table: schema.communityPostSchema, owner: schema.communityPostSchema.authorId },
  { table: schema.episodeSchema, owner: schema.episodeSchema.userId },
  { table: schema.questionnaireResponseSchema, owner: schema.questionnaireResponseSchema.userId },
  { table: schema.featureRequestSchema, owner: schema.featureRequestSchema.userId },
  { table: schema.appointmentPrepSchema, owner: schema.appointmentPrepSchema.userId },
  { table: schema.doctorShareLinkSchema, owner: schema.doctorShareLinkSchema.userId },
  { table: schema.riskAlertRunSchema, owner: schema.riskAlertRunSchema.userId },
  { table: schema.insightsCacheSchema, owner: schema.insightsCacheSchema.userId },
  { table: schema.insightTestPlanSchema, owner: schema.insightTestPlanSchema.userId },
  { table: schema.doctorVerificationApplicationSchema, owner: schema.doctorVerificationApplicationSchema.userId },
  { table: schema.mcpToolCallAuditSchema, owner: schema.mcpToolCallAuditSchema.userId },
  { table: schema.idempotentRequestSchema, owner: schema.idempotentRequestSchema.userId },
];
