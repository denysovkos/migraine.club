import type { ProtectorType, TriggerType } from '@/types/Episode';
import { Protector, Trigger } from '@/types/Episode';

export const TRIGGER_KEY_TO_VALUE = {
  sleep_issue: Trigger.SLEEP_ISSUE,
  stress: Trigger.STRESS,
  food: Trigger.FOOD,
  skipped_meal: Trigger.SKIPPED_MEAL,
  dehydration: Trigger.DEHYDRATION,
  caffeine: Trigger.CAFFEINE,
  alcohol: Trigger.ALCOHOL,
  screen_time: Trigger.SCREEN_TIME,
  weather: Trigger.WEATHER,
  hormones: Trigger.HORMONES,
  exercise: Trigger.EXERCISE,
  other: Trigger.OTHER,
} as const satisfies Record<string, TriggerType>;

export type EpisodeTriggerFactorKey = keyof typeof TRIGGER_KEY_TO_VALUE;

export const TRIGGER_VALUE_TO_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(TRIGGER_KEY_TO_VALUE).map(([key, value]) => [value, key]),
  ) as Record<TriggerType, EpisodeTriggerFactorKey>,
);

export const PROTECTOR_KEY_TO_VALUE = {
  good_sleep: Protector.GOOD_SLEEP,
  hydration: Protector.HYDRATION,
  regular_meals: Protector.REGULAR_MEALS,
  rest: Protector.REST,
  physical_activity: Protector.EXERCISE,
  screen_breaks: Protector.SCREEN_BREAKS,
  acute_med_early: Protector.ACUTE_MED_EARLY,
  preventive_taken: Protector.PREVENTIVE_TAKEN,
  calm_low_stress: Protector.CALM_LOW_STRESS,
  other_protector: Protector.OTHER,
} as const satisfies Record<string, ProtectorType>;

export type EpisodeProtectorFactorKey = keyof typeof PROTECTOR_KEY_TO_VALUE;

export const PROTECTOR_VALUE_TO_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(PROTECTOR_KEY_TO_VALUE).map(([key, value]) => [value, key]),
  ) as Record<ProtectorType, EpisodeProtectorFactorKey>,
);
