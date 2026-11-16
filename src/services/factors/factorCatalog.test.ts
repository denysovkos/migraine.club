import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_FACTOR_GROUPS,
  getBuiltInFactorsByType,
} from './factorCatalog';

describe('factorCatalog', () => {
  it('returns stable built-in trigger definitions', () => {
    const triggers = getBuiltInFactorsByType('trigger');

    expect(triggers.map(item => item.key)).toEqual([
      'sleep_issue',
      'stress',
      'skipped_meal',
      'dehydration',
      'caffeine',
      'alcohol',
      'screen_time',
      'weather',
      'hormones',
      'exercise',
      'other',
    ]);
  });

  it('keeps trigger and protector keys unique across groups', () => {
    const allKeys = BUILT_IN_FACTOR_GROUPS.flatMap(group => group.items.map(item => item.key));

    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('preserves clarified protector translation keys', () => {
    const protectors = getBuiltInFactorsByType('protector');

    expect(protectors.find(item => item.key === 'physical_activity')?.translationKey).toBe(
      'builtins.protector.exercise',
    );
    expect(protectors.find(item => item.key === 'other_protector')?.translationKey).toBe(
      'builtins.protector.other',
    );
  });

  it('returns defensive copies of built-in factors', () => {
    const protectors = getBuiltInFactorsByType('protector');
    const mutatedProtectors = protectors as Array<{ key: string }>;
    const firstProtector = mutatedProtectors[0];

    expect(firstProtector).toBeDefined();

    if (!firstProtector) {
      throw new Error('Expected at least one protector factor');
    }

    firstProtector.key = 'mutated';

    expect(getBuiltInFactorsByType('protector')[0]!.key).toBe('good_sleep');
  });
});
