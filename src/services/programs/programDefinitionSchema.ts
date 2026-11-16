import { z } from 'zod';

import { IntakeMedTiming, IntakeSleepTrouble } from '@/models/intake';

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

const SleepDefaultTarget = z.object({
  bedTime: TimeOfDay,
  wakeTime: TimeOfDay,
  toleranceMinutes: z.number().int().min(0).max(180),
});

const AcuteDefaultTarget = z.object({
  acuteWindowMinutes: z.number().int().min(1).max(360),
});

const DefaultTarget = z.union([SleepDefaultTarget, AcuteDefaultTarget]);

const RecommendationTrigger = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('factor-frequency'),
    factor: z.string(),
    values: z.array(z.string()),
    minDays: z.number().int().min(1),
    windowDays: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('headache-rate'),
    minHeadacheDays: z.number().int().min(1),
    windowDays: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('onset-to-dose'),
    averageMinutesAtLeast: z.number().int().min(0),
    windowDays: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('acute-med-days'),
    minDays: z.number().int().min(1),
    windowDays: z.number().int().min(1),
  }),
  z.discriminatedUnion('field', [
    z.object({
      kind: z.literal('intake-answer'),
      field: z.literal('sleepTrouble'),
      values: z.array(IntakeSleepTrouble).min(1),
    }),
    z.object({
      kind: z.literal('intake-answer'),
      field: z.literal('medTiming'),
      values: z.array(IntakeMedTiming).min(1),
    }),
  ]),
]);

const Citation = z.object({
  id: z.string(),
  label: z.string(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  url: z.string().url().optional(),
});

export const ProgramDefinitionFrontmatter = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  shape: z.enum(['daily-habit', 'per-attack-rule']),
  durationWeeks: z.number().int().min(1).max(52),
  adherenceMetric: z.enum(['bedtime-wake-window', 'onset-to-dose']),
  defaultTarget: DefaultTarget,
  recommendationTriggers: z.array(RecommendationTrigger),
  citations: z.array(Citation),
  disclaimer: z.string().min(1),
});

export type ProgramDefinitionFrontmatterT = z.infer<typeof ProgramDefinitionFrontmatter>;
export type RecommendationTriggerT = z.infer<typeof RecommendationTrigger>;
