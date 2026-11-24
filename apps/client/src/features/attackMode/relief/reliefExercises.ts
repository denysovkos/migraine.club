/**
 * In-attack relief exercises: slow paced breathing, a migraine-adapted
 * progressive muscle relaxation (PMR) and a short guided relaxation.
 *
 * Each exercise is a fixed list of timed steps. The words live in the
 * `ReliefTools` translations under `step_<key>`, so the same script is shown
 * on screen and, when voice is on, read aloud by the device's own speech
 * engine. Nothing here needs a network connection.
 *
 * Content choices:
 * - Breathing: about 6 breaths a minute (4 s in, 6 s out), the slow-breathing
 *   pace used in headache relaxation and biofeedback programmes. A longer
 *   out-breath than in-breath keeps it calming rather than activating.
 * - PMR: the abbreviated Jacobson sequence, tensing at about half strength.
 *   Face, jaw and neck are only softened, never tensed, so a head that is
 *   already hurting is not strained.
 * - Guided relaxation: a body scan into a cool, dim, quiet place, written
 *   for someone lying still with eyes closed.
 */

import type { ReliefExercise } from '@/types/Relief';

export { isReliefExercise, RELIEF_EXERCISES, RELIEF_HELPED_CHOICES } from '@/types/Relief';
export type { ReliefExercise, ReliefHelped } from '@/types/Relief';

/** `breathe_in` / `breathe_out` are paced breaths; `tense` / `release` are PMR phases; `guide` is spoken guidance. */
export type ReliefPhase = 'guide' | 'breathe_in' | 'breathe_out' | 'tense' | 'release';

export type ReliefStep = {
  /** Translation key suffix: `ReliefTools.step_<key>`. */
  key: string;
  phase: ReliefPhase;
  seconds: number;
  /** 1-based breath number, for the "Breath 3 of 18" label. */
  breath?: number;
};

export const BREATH_IN_SECONDS = 4;
export const BREATH_OUT_SECONDS = 6;
export const BREATH_COUNT = 18;

const PMR_TENSE_SECONDS = 5;
const PMR_RELEASE_SECONDS = 15;

/** Tensed and released, in this order. No face, jaw or neck. */
export const PMR_GROUPS = ['hands', 'upper_arms', 'shoulders', 'stomach', 'thighs', 'calves', 'feet'] as const;

function breathingSteps(): ReliefStep[] {
  const steps: ReliefStep[] = [{ key: 'breathing_intro', phase: 'guide', seconds: 10 }];
  for (let breath = 1; breath <= BREATH_COUNT; breath++) {
    steps.push({ key: 'breathe_in', phase: 'breathe_in', seconds: BREATH_IN_SECONDS, breath });
    steps.push({ key: 'breathe_out', phase: 'breathe_out', seconds: BREATH_OUT_SECONDS, breath });
  }
  steps.push({ key: 'breathing_outro', phase: 'guide', seconds: 10 });
  return steps;
}

function pmrSteps(): ReliefStep[] {
  const steps: ReliefStep[] = [{ key: 'pmr_intro', phase: 'guide', seconds: 15 }];
  for (const group of PMR_GROUPS) {
    steps.push({ key: `pmr_tense_${group}`, phase: 'tense', seconds: PMR_TENSE_SECONDS });
    steps.push({ key: 'pmr_release', phase: 'release', seconds: PMR_RELEASE_SECONDS });
  }
  steps.push({ key: 'pmr_soften_face', phase: 'guide', seconds: 20 });
  steps.push({ key: 'pmr_outro', phase: 'guide', seconds: 15 });
  return steps;
}

const RELAXATION_KEYS = [
  'relax_position',
  'relax_breath',
  'relax_support',
  'relax_legs',
  'relax_arms',
  'relax_shoulders',
  'relax_place',
  'relax_details',
  'relax_wander',
  'relax_stay',
  'relax_outro',
] as const;

function relaxationSteps(): ReliefStep[] {
  return RELAXATION_KEYS.map(key => ({ key, phase: 'guide' as const, seconds: 20 }));
}

const STEPS: Record<ReliefExercise, readonly ReliefStep[]> = {
  breathing: breathingSteps(),
  pmr: pmrSteps(),
  relaxation: relaxationSteps(),
};

export function exerciseSteps(exercise: ReliefExercise): readonly ReliefStep[] {
  return STEPS[exercise];
}

export function totalSeconds(exercise: ReliefExercise): number {
  return STEPS[exercise].reduce((sum, s) => sum + s.seconds, 0);
}

/** Whole minutes, rounded, at least 1: what the exercise button promises. */
export function totalMinutes(exercise: ReliefExercise): number {
  return Math.max(1, Math.round(totalSeconds(exercise) / 60));
}

export type ReliefPosition
  = | { done: false; index: number; step: ReliefStep; secondsLeft: number }
    | { done: true };

/**
 * Where a session is after `elapsedMs`. Driven by the wall clock rather than
 * by counting timer ticks, so a throttled background tab or a locked phone
 * picks up at the right step when it wakes.
 */
export function positionAt(steps: readonly ReliefStep[], elapsedMs: number): ReliefPosition {
  let remaining = Math.max(0, elapsedMs) / 1000;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    if (remaining < step.seconds) {
      return { done: false, index, step, secondsLeft: Math.ceil(step.seconds - remaining) };
    }
    remaining -= step.seconds;
  }
  return { done: true };
}
