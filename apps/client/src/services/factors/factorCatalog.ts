import type { FactorTypeType } from '@migraine/db/schema';
import { FactorType } from '@migraine/db/schema';

export type BuiltInFactor = Readonly<{
  key: string;
  type: Extract<FactorTypeType, 'trigger' | 'protector'>;
  translationKey: string;
}>;

type BuiltInFactorGroup = Readonly<{
  type: Extract<FactorTypeType, 'trigger' | 'protector'>;
  items: ReadonlyArray<BuiltInFactor>;
}>;

export const BUILT_IN_FACTOR_GROUPS: ReadonlyArray<BuiltInFactorGroup> = Object.freeze([
  Object.freeze({
    type: FactorType.TRIGGER,
    items: Object.freeze([
      Object.freeze({
        key: 'sleep_issue',
        type: FactorType.TRIGGER,
        translationKey: 'builtins.trigger.sleep_issue',
      }),
      Object.freeze({ key: 'stress', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.stress' }),
      Object.freeze({
        key: 'skipped_meal',
        type: FactorType.TRIGGER,
        translationKey: 'builtins.trigger.skipped_meal',
      }),
      Object.freeze({
        key: 'dehydration',
        type: FactorType.TRIGGER,
        translationKey: 'builtins.trigger.dehydration',
      }),
      Object.freeze({ key: 'caffeine', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.caffeine' }),
      Object.freeze({ key: 'alcohol', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.alcohol' }),
      Object.freeze({
        key: 'screen_time',
        type: FactorType.TRIGGER,
        translationKey: 'builtins.trigger.screen_time',
      }),
      Object.freeze({ key: 'weather', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.weather' }),
      Object.freeze({ key: 'hormones', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.hormones' }),
      Object.freeze({ key: 'exercise', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.exercise' }),
      Object.freeze({ key: 'other', type: FactorType.TRIGGER, translationKey: 'builtins.trigger.other' }),
    ]),
  }),
  Object.freeze({
    type: FactorType.PROTECTOR,
    items: Object.freeze([
      Object.freeze({
        key: 'good_sleep',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.good_sleep',
      }),
      Object.freeze({
        key: 'hydration',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.hydration',
      }),
      Object.freeze({
        key: 'regular_meals',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.regular_meals',
      }),
      Object.freeze({ key: 'rest', type: FactorType.PROTECTOR, translationKey: 'builtins.protector.rest' }),
      Object.freeze({
        key: 'physical_activity',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.exercise',
      }),
      Object.freeze({
        key: 'screen_breaks',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.screen_breaks',
      }),
      Object.freeze({
        key: 'acute_med_early',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.acute_med_early',
      }),
      Object.freeze({
        key: 'preventive_taken',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.preventive_taken',
      }),
      Object.freeze({
        key: 'calm_low_stress',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.calm_low_stress',
      }),
      Object.freeze({
        key: 'other_protector',
        type: FactorType.PROTECTOR,
        translationKey: 'builtins.protector.other',
      }),
    ]),
  }),
]);

export function getBuiltInFactorsByType(
  type: Extract<FactorTypeType, 'trigger' | 'protector'>,
): BuiltInFactor[] {
  return BUILT_IN_FACTOR_GROUPS.find(group => group.type === type)?.items.map(item => ({ ...item })) ?? [];
}
