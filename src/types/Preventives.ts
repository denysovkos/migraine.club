import { z } from 'zod';

export const PreventivePlanKind = {
  ORAL: 'oral',
  INJECTION: 'injection',
  INFUSION: 'infusion',
  DEVICE: 'device',
  SUPPLEMENT: 'supplement',
  OTHER: 'other',
} as const;
export type PreventivePlanKindType = (typeof PreventivePlanKind)[keyof typeof PreventivePlanKind];

export const PreventiveScheduleType = {
  DAILY: 'daily',
  WEEKDAYS: 'weekdays',
  EVERY_N_DAYS: 'every_n_days',
  EVERY_N_WEEKS: 'every_n_weeks',
  CUSTOM_WEEKDAYS: 'custom_weekdays',
  ON_SPECIFIC_DATES: 'on_specific_dates',
} as const;
export type PreventiveScheduleTypeType
  = (typeof PreventiveScheduleType)[keyof typeof PreventiveScheduleType];

export const PreventivePlanStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  STOPPED: 'stopped',
} as const;
export type PreventivePlanStatusType
  = (typeof PreventivePlanStatus)[keyof typeof PreventivePlanStatus];

export const PreventiveStopReason = {
  SIDE_EFFECTS: 'side_effects',
  NOT_HELPING: 'not_helping',
  COMPLETED: 'completed',
  COST: 'cost',
  OTHER: 'other',
} as const;
export type PreventiveStopReasonType
  = (typeof PreventiveStopReason)[keyof typeof PreventiveStopReason];

export const PreventiveIntakeState = {
  TAKEN: 'taken',
  MISSED: 'missed',
  UNSURE: 'unsure',
} as const;
export type PreventiveIntakeStateType
  = (typeof PreventiveIntakeState)[keyof typeof PreventiveIntakeState];

export const PreventiveSideEffect = {
  NONE: 'none',
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
} as const;
export type PreventiveSideEffectType
  = (typeof PreventiveSideEffect)[keyof typeof PreventiveSideEffect];

export const PreventiveStillTaking = {
  YES: 'yes',
  PAUSED: 'paused',
  STOPPED: 'stopped',
} as const;
export type PreventiveStillTakingType
  = (typeof PreventiveStillTaking)[keyof typeof PreventiveStillTaking];

export type PreventiveSchedulePayload
  = | null
    | { n: number }
    | number[]
    | string[];

const SchedulePayloadSchema = z.union([
  z.null(),
  z.object({ n: z.number().int().positive() }),
  z.array(z.number().int().min(1).max(7)),
  z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
]);

/**
 * Feature F42: reminder times are user-local wall-clock HH:mm.
 *
 * They are stored exactly as entered — the cron fires at the first tick at or
 * after a slot, so with a 30-minute cron an 08:15 dose is reminded at 08:30.
 * Rounding the user's input instead would silently rewrite what they typed.
 */
/**
 * Reminder times sit on the half hour.
 *
 * The cron ticks every 30 minutes, so a 09:27 slot could only ever be pushed
 * at 09:30 anyway — offering minute precision promised an accuracy the delivery
 * path does not have.
 */
export const REMINDER_TIME_REGEX = /^([01]\d|2[0-3]):(00|30)$/;
export const MAX_REMINDER_TIMES = 8;

/** Every half-hour slot of the day, in the order the picker lists them. */
export const REMINDER_TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, '0');

  return `${hour}:${i % 2 === 0 ? '00' : '30'}`;
});

/** Sorted, de-duplicated, capped. Applied on both write paths. */
export function normalizeReminderTimes(times: string[]): string[] {
  return [...new Set(times)].sort().slice(0, MAX_REMINDER_TIMES);
}

const ReminderTimesSchema = z
  .array(z.string().regex(REMINDER_TIME_REGEX))
  .max(MAX_REMINDER_TIMES)
  .transform(normalizeReminderTimes);

export const CreatePreventivePlanSchema = z.object({
  catalogMedicationId: z.string().guid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  kind: z.enum([
    PreventivePlanKind.ORAL,
    PreventivePlanKind.INJECTION,
    PreventivePlanKind.INFUSION,
    PreventivePlanKind.DEVICE,
    PreventivePlanKind.SUPPLEMENT,
    PreventivePlanKind.OTHER,
  ]),
  doseText: z.string().trim().max(120).optional().nullable(),
  scheduleType: z.enum([
    PreventiveScheduleType.DAILY,
    PreventiveScheduleType.WEEKDAYS,
    PreventiveScheduleType.EVERY_N_DAYS,
    PreventiveScheduleType.EVERY_N_WEEKS,
    PreventiveScheduleType.CUSTOM_WEEKDAYS,
    PreventiveScheduleType.ON_SPECIFIC_DATES,
  ]),
  schedulePayload: SchedulePayloadSchema.optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reminderTimes: ReminderTimesSchema.optional(),
  remindersEnabled: z.boolean().optional(),
});

export const UpdatePreventivePlanSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum([
    PreventivePlanKind.ORAL,
    PreventivePlanKind.INJECTION,
    PreventivePlanKind.INFUSION,
    PreventivePlanKind.DEVICE,
    PreventivePlanKind.SUPPLEMENT,
    PreventivePlanKind.OTHER,
  ]).optional(),
  doseText: z.string().trim().max(120).optional().nullable(),
  scheduleType: z.enum([
    PreventiveScheduleType.DAILY,
    PreventiveScheduleType.WEEKDAYS,
    PreventiveScheduleType.EVERY_N_DAYS,
    PreventiveScheduleType.EVERY_N_WEEKS,
    PreventiveScheduleType.CUSTOM_WEEKDAYS,
    PreventiveScheduleType.ON_SPECIFIC_DATES,
  ]).optional(),
  schedulePayload: SchedulePayloadSchema.optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reminderTimes: ReminderTimesSchema.optional(),
  remindersEnabled: z.boolean().optional(),
});

export const PreventiveIntakeUpsertSchema = z.object({
  planId: z.string().guid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: z.enum([
    PreventiveIntakeState.TAKEN,
    PreventiveIntakeState.MISSED,
    PreventiveIntakeState.UNSURE,
  ]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const PreventiveWeeklyCheckInSchema = z.object({
  planId: z.string().guid(),
  weekStartLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sideEffects: z.enum([
    PreventiveSideEffect.NONE,
    PreventiveSideEffect.MILD,
    PreventiveSideEffect.MODERATE,
    PreventiveSideEffect.SEVERE,
  ]),
  stillTaking: z.enum([
    PreventiveStillTaking.YES,
    PreventiveStillTaking.PAUSED,
    PreventiveStillTaking.STOPPED,
  ]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const PreventiveStopSchema = z.object({
  reason: z.enum([
    PreventiveStopReason.SIDE_EFFECTS,
    PreventiveStopReason.NOT_HELPING,
    PreventiveStopReason.COMPLETED,
    PreventiveStopReason.COST,
    PreventiveStopReason.OTHER,
  ]),
  reasonNote: z.string().trim().max(500).optional().nullable(),
});

export type CreatePreventivePlanInput = z.infer<typeof CreatePreventivePlanSchema>;
export type UpdatePreventivePlanInput = z.infer<typeof UpdatePreventivePlanSchema>;
export type PreventiveIntakeUpsertInput = z.infer<typeof PreventiveIntakeUpsertSchema>;
export type PreventiveWeeklyCheckInInput = z.infer<typeof PreventiveWeeklyCheckInSchema>;
export type PreventiveStopInput = z.infer<typeof PreventiveStopSchema>;
