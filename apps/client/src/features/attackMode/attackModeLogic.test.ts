import { describe, expect, it } from 'vitest';
import { painLevelMeta } from '@/utils/painLevel';
import {
  ATTACK_MODE_MAX_MEDS,
  ATTACK_PAIN_CHOICES,
  formatDose,
  intensityToPainChoice,
  isAttackModePath,
  limitMeds,
  painChoiceToIntensity,
} from './attackModeLogic';

describe('painChoiceToIntensity', () => {
  it('stores the 1–5 level whose label matches the tapped word', () => {
    expect(painLevelMeta(painChoiceToIntensity('mild')).label).toBe('Mild');
    expect(painLevelMeta(painChoiceToIntensity('moderate')).label).toBe('Moderate');
    expect(painLevelMeta(painChoiceToIntensity('severe')).label).toBe('Severe');
  });

  it('round-trips every choice', () => {
    for (const choice of ATTACK_PAIN_CHOICES) {
      expect(intensityToPainChoice(painChoiceToIntensity(choice))).toBe(choice);
    }
  });
});

describe('intensityToPainChoice', () => {
  it.each([
    [1, 'mild'],
    [2, 'mild'],
    [3, 'moderate'],
    [4, 'severe'],
    [5, 'severe'],
  ] as const)('maps %i to %s', (level, choice) => {
    expect(intensityToPainChoice(level)).toBe(choice);
  });

  it.each([null, undefined, 0, 6, 2.5, Number.NaN])('returns null for %s', (value) => {
    expect(intensityToPainChoice(value)).toBeNull();
  });
});

describe('limitMeds', () => {
  it(`keeps at most ${ATTACK_MODE_MAX_MEDS} in their original order`, () => {
    expect(limitMeds(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
    expect(limitMeds(['a'])).toEqual(['a']);
    expect(limitMeds([])).toEqual([]);
  });
});

describe('formatDose', () => {
  it('joins dose and unit, skipping blanks', () => {
    expect(formatDose('50', 'mg')).toBe('50 mg');
    expect(formatDose('1', null)).toBe('1');
    expect(formatDose(null, 'mg')).toBe('mg');
    expect(formatDose(' ', undefined)).toBe('');
  });
});

describe('isAttackModePath', () => {
  it.each(['/quick/attack', '/uk/quick/attack', '/fr/quick/attack/'])('matches %s', (p) => {
    expect(isAttackModePath(p)).toBe(true);
  });

  it.each([null, undefined, '', '/', '/dashboard', '/quick/sleep', '/quick/attack/x'])('does not match %s', (p) => {
    expect(isAttackModePath(p)).toBe(false);
  });
});
