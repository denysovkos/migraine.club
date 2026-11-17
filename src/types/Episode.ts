import { z } from 'zod';

// Enums
export const PainLocation = {
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  FRONTAL: 'FRONTAL',
  OCCIPITAL: 'OCCIPITAL',
  WHOLE_HEAD: 'WHOLE_HEAD',
  OTHER: 'OTHER',
} as const;

export const PainType = {
  THROBBING: 'THROBBING',
  STABBING: 'STABBING',
  PRESSURE: 'PRESSURE',
  BURNING: 'BURNING',
  OTHER: 'OTHER',
} as const;

export const Symptom = {
  NAUSEA: 'NAUSEA',
  VOMITING: 'VOMITING',
  PHOTOPHOBIA: 'PHOTOPHOBIA',
  PHONOPHOBIA: 'PHONOPHOBIA',
  AURA: 'AURA',
  DIZZINESS: 'DIZZINESS',
  NECK_PAIN: 'NECK_PAIN',
  OTHER: 'OTHER',
} as const;

export const Trigger = {
  STRESS: 'STRESS',
  SLEEP_ISSUE: 'SLEEP_ISSUE',
  FOOD: 'FOOD',
  SKIPPED_MEAL: 'SKIPPED_MEAL',
  DEHYDRATION: 'DEHYDRATION',
  CAFFEINE: 'CAFFEINE',
  ALCOHOL: 'ALCOHOL',
  HORMONES: 'HORMONES',
  SCREEN_TIME: 'SCREEN_TIME',
  WEATHER: 'WEATHER',
  EXERCISE: 'EXERCISE',
  OTHER: 'OTHER',
} as const;

export const Protector = {
  GOOD_SLEEP: 'GOOD_SLEEP',
  HYDRATION: 'HYDRATION',
  REGULAR_MEALS: 'REGULAR_MEALS',
  REST: 'REST',
  EXERCISE: 'EXERCISE',
  SCREEN_BREAKS: 'SCREEN_BREAKS',
  ACUTE_MED_EARLY: 'ACUTE_MED_EARLY',
  PREVENTIVE_TAKEN: 'PREVENTIVE_TAKEN',
  CALM_LOW_STRESS: 'CALM_LOW_STRESS',
  OTHER: 'OTHER',
} as const;

export type PainLocationType = typeof PainLocation[keyof typeof PainLocation];
export type PainTypeType = typeof PainType[keyof typeof PainType];
export type SymptomType = typeof Symptom[keyof typeof Symptom];
export type TriggerType = typeof Trigger[keyof typeof Trigger];
export type ProtectorType = typeof Protector[keyof typeof Protector];

export const MedicationIntakeEntrySchema = z.object({
  id: z.string().guid(),
  takenAt: z.string().datetime(),
  label: z.string().min(1).max(200),
  dose: z.string().max(100).nullable(),
  unit: z.string().max(50).nullable(),
  unitIsCustom: z.boolean(),
});
export type MedicationIntakeEntry = z.infer<typeof MedicationIntakeEntrySchema>;

export const AcuteDoseOutcomeEntrySchema = z.object({
  doseId: z.string().guid(),
  medicationId: z.string().guid(),
  medicationLabel: z.string().min(1),
  medicationClass: z.string().min(1),
  takenAt: z.string().datetime(),
  dose: z.string().nullable(),
  unit: z.string().nullable(),
  unitIsCustom: z.boolean(),
  notes: z.string().nullable(),
  outcome: z.object({
    helped: z.enum(['yes', 'partly', 'no']),
    backToNormalFunction: z.boolean().nullable(),
    timeToReliefMinutes: z.number().int().nullable(),
    notes: z.string().nullable(),
    updatedAt: z.string().datetime(),
  }).nullable(),
  neededSecondDose: z.boolean(),
  neededRescue: z.boolean(),
});
export type AcuteDoseOutcomeEntry = z.infer<typeof AcuteDoseOutcomeEntrySchema>;

// Episode validation schema
export const CreateEpisodeSchema = z
  .object({
    // Unified "Attack" classification (migraine vs non-migraine headache)
    attackType: z.enum(['migraine', 'headache']).optional(),
    startTime: z.string().datetime().optional(),
    onsetAt: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    isOngoing: z.boolean().optional(),
    intensity: z.number().int().min(1).max(5),
    painLocation: z.nativeEnum(PainLocation),
    painLocationOther: z.string().max(200).optional(),
    painType: z.nativeEnum(PainType),
    painTypeOther: z.string().max(200).optional(),
    symptoms: z.array(z.nativeEnum(Symptom)).default([]),
    symptomsOther: z.string().max(500).optional(),
    triggers: z.array(z.nativeEnum(Trigger)).default([]),
    protectors: z.array(z.nativeEnum(Protector)).default([]),
    triggersOther: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => {
      if (data.isOngoing) {
        return !data.endTime;
      }
      return true;
    },
    {
      message: 'endTime must be null when isOngoing is true',
      path: ['endTime'],
    },
  )
  .refine(
    (data) => {
      if (data.startTime && data.endTime && !data.isOngoing) {
        return new Date(data.endTime) >= new Date(data.startTime);
      }
      return true;
    },
    {
      message: 'endTime must be >= startTime',
      path: ['endTime'],
    },
  );

export const UpdateEpisodeSchema = z
  .object({
    // Unified "Attack" classification (migraine vs non-migraine headache)
    attackType: z.enum(['migraine', 'headache']).optional(),
    startTime: z.string().datetime().optional(),
    onsetAt: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    isOngoing: z.boolean().optional(),
    endNow: z.boolean().optional(),
    // With endNow: the moment the user tapped "end" on their device. Lets an
    // end queued offline keep its real time instead of the sync time.
    endedAt: z.string().datetime().optional(),
    intensity: z.number().int().min(1).max(5).optional(),
    painLocation: z.nativeEnum(PainLocation).optional(),
    painLocationOther: z.string().max(200).optional(),
    painType: z.nativeEnum(PainType).optional(),
    painTypeOther: z.string().max(200).optional(),
    symptoms: z.array(z.nativeEnum(Symptom)).optional(),
    symptomsOther: z.string().max(500).optional(),
    triggers: z.array(z.nativeEnum(Trigger)).optional(),
    protectors: z.array(z.nativeEnum(Protector)).optional(),
    triggersOther: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => {
      if (data.isOngoing) {
        return !data.endTime;
      }
      return true;
    },
    {
      message: 'endTime must be null when isOngoing is true',
      path: ['endTime'],
    },
  )
  .refine(
    (data) => {
      if (data.startTime && data.endTime && !data.isOngoing) {
        return new Date(data.endTime) >= new Date(data.startTime);
      }
      return true;
    },
    {
      message: 'endTime must be >= startTime',
      path: ['endTime'],
    },
  );

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;

// Weather context stored with episode
export type EpisodeWeatherContext = {
  wpiScore: number;
  wpiLevel: 'low' | 'moderate' | 'high' | 'very_high';
  kpIndex: number | null;
  deltaPressure: number;
  temperatureDeviation: number;
  humidity: number;
  windSpeed: number;
  uvi: number;
  components?: {
    pressureFactor: number;
    humidityFactor: number;
    tempFactor: number;
    windFactor: number;
    uviFactor: number;
    solarFactor: number;
  };
};

// Episode domain model (from DB)
export type Episode = {
  id: number;
  userId: string;
  // Optional for backward compatibility; newer API callers can rely on it.
  attackType?: 'migraine' | 'headache';
  startTime: Date;
  // True onset time. Falls back to startTime when null.
  onsetAt?: Date | null;
  endTime: Date | null;
  isOngoing: boolean;
  intensity: number;
  painLocation: PainLocationType;
  painLocationOther: string | null;
  painType: PainTypeType;
  painTypeOther: string | null;
  symptoms: SymptomType[];
  symptomsOther: string | null;
  medicationIntakes: MedicationIntakeEntry[];
  attackTreatment?: {
    attackId: number;
    doses: AcuteDoseOutcomeEntry[];
    flags: {
      anySecondDose: boolean;
      anyRescue: boolean;
    };
  };
  triggers: TriggerType[];
  protectors: ProtectorType[];
  triggersOther: string | null;
  notes: string | null;
  weatherPainIndexId: string | null;
  weatherContext: EpisodeWeatherContext | null;
  createdAt: Date;
  updatedAt: Date;
};
