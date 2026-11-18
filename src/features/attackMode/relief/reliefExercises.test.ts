import { describe, expect, it } from 'vitest';
import {
  BREATH_COUNT,
  BREATH_IN_SECONDS,
  BREATH_OUT_SECONDS,
  exerciseSteps,
  isReliefExercise,
  PMR_GROUPS,
  positionAt,
  RELIEF_EXERCISES,
  totalMinutes,
  totalSeconds,
} from './reliefExercises';

describe('relief exercises', () => {
  it('paces breathing at about six breaths a minute with a longer out-breath', () => {
    const steps = exerciseSteps('breathing');
    const ins = steps.filter(s => s.phase === 'breathe_in');
    const outs = steps.filter(s => s.phase === 'breathe_out');

    expect(ins).toHaveLength(BREATH_COUNT);
    expect(outs).toHaveLength(BREATH_COUNT);
    expect(BREATH_OUT_SECONDS).toBeGreaterThan(BREATH_IN_SECONDS);
    expect(60 / (BREATH_IN_SECONDS + BREATH_OUT_SECONDS)).toBe(6);
    expect(ins.map(s => s.breath)).toEqual(Array.from({ length: BREATH_COUNT }, (_, i) => i + 1));
  });

  it('never tenses face, jaw or neck in muscle relaxation', () => {
    const tensed = exerciseSteps('pmr').filter(s => s.phase === 'tense').map(s => s.key);

    expect(tensed).toEqual(PMR_GROUPS.map(g => `pmr_tense_${g}`));
    expect(tensed.join(' ')).not.toMatch(/face|jaw|neck|forehead|eye/);

    // Every tense is followed by a longer release.
    const steps = exerciseSteps('pmr');
    steps.forEach((s, i) => {
      if (s.phase === 'tense') {
        expect(steps[i + 1]?.phase).toBe('release');
        expect(steps[i + 1]!.seconds).toBeGreaterThan(s.seconds);
      }
    });
  });

  it('keeps every exercise short enough to finish during an attack', () => {
    for (const exercise of RELIEF_EXERCISES) {
      expect(totalSeconds(exercise)).toBeGreaterThanOrEqual(120);
      expect(totalSeconds(exercise)).toBeLessThanOrEqual(300);
      expect(totalMinutes(exercise)).toBeGreaterThanOrEqual(2);
    }
  });

  it('recognises exercise ids', () => {
    expect(isReliefExercise('breathing')).toBe(true);
    expect(isReliefExercise('yoga')).toBe(false);
    expect(isReliefExercise(undefined)).toBe(false);
  });
});

describe('positionAt', () => {
  const steps = [
    { key: 'a', phase: 'guide' as const, seconds: 10 },
    { key: 'b', phase: 'breathe_in' as const, seconds: 4 },
  ];

  it('starts on the first step with its full time', () => {
    expect(positionAt(steps, 0)).toEqual({ done: false, index: 0, step: steps[0], secondsLeft: 10 });
  });

  it('rounds the countdown up so it never shows 0 mid-step', () => {
    expect(positionAt(steps, 9_100)).toMatchObject({ index: 0, secondsLeft: 1 });
  });

  it('moves to the next step at the boundary', () => {
    expect(positionAt(steps, 10_000)).toMatchObject({ index: 1, secondsLeft: 4 });
  });

  it('catches up after a long gap, as after a locked screen', () => {
    expect(positionAt(steps, 12_500)).toMatchObject({ index: 1, secondsLeft: 2 });
    expect(positionAt(steps, 60_000)).toEqual({ done: true });
  });

  it('treats a negative elapsed time (clock moved back) as the start', () => {
    expect(positionAt(steps, -5_000)).toMatchObject({ index: 0, secondsLeft: 10 });
  });
});
