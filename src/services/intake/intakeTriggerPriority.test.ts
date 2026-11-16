import { describe, expect, it } from 'vitest';

import { sortTriggersByIntake } from './intakeTriggerPriority';

const items = [
  { key: 'stress' },
  { key: 'caffeine' },
  { key: 'weather' },
  { key: 'alcohol' },
];

describe('sortTriggersByIntake', () => {
  it('moves intake-selected triggers to the front', () => {
    const sorted = sortTriggersByIntake(items, ['weather', 'alcohol']);

    expect(sorted.map(i => i.key)).toEqual(['weather', 'alcohol', 'stress', 'caffeine']);
  });

  it('preserves the intake order among the selected ones', () => {
    const sorted = sortTriggersByIntake(items, ['alcohol', 'weather']);

    expect(sorted.slice(0, 2).map(i => i.key)).toEqual(['alcohol', 'weather']);
  });

  it('returns the original order when nothing was selected', () => {
    const sorted = sortTriggersByIntake(items, []);

    expect(sorted.map(i => i.key)).toEqual(['stress', 'caffeine', 'weather', 'alcohol']);
  });

  it('ignores intake keys that are not in the list', () => {
    const sorted = sortTriggersByIntake(items, ['not_a_factor', 'stress']);

    expect(sorted.map(i => i.key)).toEqual(['stress', 'caffeine', 'weather', 'alcohol']);
  });
});
