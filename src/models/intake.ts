import { z } from 'zod';

/**
 * Question-set version. Bump when the shape of `answers` changes so stored rows
 * keep parsing against the schema they were written with.
 */
export const INTAKE_VERSION = 1;

export const IntakeStatus = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
} as const;
export type IntakeStatusType = (typeof IntakeStatus)[keyof typeof IntakeStatus];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const IntakeFrequencyBand = z.enum(['lt1', '1_3', '4_7', '8_14', '15_plus']);
export type IntakeFrequencyBandType = z.infer<typeof IntakeFrequencyBand>;

export const IntakeSleepTrouble = z.enum(['often', 'sometimes', 'rarely']);
export type IntakeSleepTroubleType = z.infer<typeof IntakeSleepTrouble>;
export const IntakeMedTiming = z.enum(['lt30', '30_120', 'gt120', 'varies']);
export type IntakeMedTimingType = z.infer<typeof IntakeMedTiming>;

const FrequencyBlock = z.object({
  band: IntakeFrequencyBand,
});

const TriggersBlock = z.object({
  keys: z.array(z.string().trim().min(1).max(64)).max(30),
  custom: z.array(z.string().trim().min(1).max(64)).max(10),
});

const AcuteMedEntry = z
  .object({
    catalogMedicationId: z.string().guid().nullable().optional(),
    customName: z.string().trim().min(1).max(200).nullable().optional(),
    defaultDose: z.string().trim().max(40).nullable().optional(),
    defaultUnit: z.string().trim().max(40).nullable().optional(),
    defaultUnitIsCustom: z.boolean().optional(),
    medicationClass: z
      .enum([
        'triptan',
        'ergotamine',
        'combination_analgesic',
        'opioid',
        'non_opioid_simple_analgesic',
      ])
      .optional(),
  })
  .refine(d => !!d.catalogMedicationId || !!d.customName, {
    message: 'catalogMedicationId or customName is required',
  });

const PreventiveEntry = z.object({
  catalogMedicationId: z.string().guid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['oral', 'injection', 'infusion', 'device', 'supplement', 'other']),
  doseText: z.string().trim().max(120).nullable().optional(),
  scheduleType: z.enum([
    'daily',
    'weekdays',
    'every_n_days',
    'every_n_weeks',
    'custom_weekdays',
    'on_specific_dates',
  ]),
  schedulePayload: z.unknown().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const MedicationsBlock = z.object({
  acute: z.array(AcuteMedEntry).max(20),
  preventive: z.array(PreventiveEntry).max(20),
});

const HabitsBlock = z.object({
  sleepTrouble: IntakeSleepTrouble.nullable(),
  typicalBed: z.string().regex(HHMM).nullable(),
  typicalWake: z.string().regex(HHMM).nullable(),
  medTiming: IntakeMedTiming.nullable(),
});

/**
 * Each block is independently nullable. `null` means the user skipped that step;
 * an object with empty arrays means they answered "none". Those are different
 * facts and consumers treat them differently.
 */
export const IntakeAnswersSchema = z.object({
  frequency: FrequencyBlock.nullable().default(null),
  triggers: TriggersBlock.nullable().default(null),
  medications: MedicationsBlock.nullable().default(null),
  habits: HabitsBlock.nullable().default(null),
});

export type IntakeAnswers = z.infer<typeof IntakeAnswersSchema>;
export type IntakeAcuteMedEntry = z.infer<typeof AcuteMedEntry>;
export type IntakePreventiveEntry = z.infer<typeof PreventiveEntry>;

export const INTAKE_BLOCKS = ['frequency', 'triggers', 'medications', 'habits'] as const;
export type IntakeBlockName = (typeof INTAKE_BLOCKS)[number];

/** Order of the wizard steps. Index in this array is `current_step`. */
export const INTAKE_STEP_ORDER: readonly IntakeBlockName[] = INTAKE_BLOCKS;

export const IntakeBlockPatchSchema = z.discriminatedUnion('block', [
  z.object({ block: z.literal('frequency'), value: FrequencyBlock.nullable() }),
  z.object({ block: z.literal('triggers'), value: TriggersBlock.nullable() }),
  z.object({ block: z.literal('medications'), value: MedicationsBlock.nullable() }),
  z.object({ block: z.literal('habits'), value: HabitsBlock.nullable() }),
]);

export type IntakeBlockPatch = z.infer<typeof IntakeBlockPatchSchema>;

export type IntakeSeededIds = {
  userMedicationIds: string[];
  preventivePlanIds: string[];
  factorIds: string[];
  at: string;
};
