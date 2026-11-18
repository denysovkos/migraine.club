/** In-attack relief exercises (attack mode "Relax"). Shared by the UI and the relief session API. */
export const RELIEF_EXERCISES = ['breathing', 'pmr', 'relaxation'] as const;

export type ReliefExercise = (typeof RELIEF_EXERCISES)[number];

/** Answer to "Did it help?" after a session. */
export const RELIEF_HELPED_CHOICES = ['yes', 'a_little', 'no'] as const;

export type ReliefHelped = (typeof RELIEF_HELPED_CHOICES)[number];

export function isReliefExercise(value: unknown): value is ReliefExercise {
  return typeof value === 'string' && (RELIEF_EXERCISES as readonly string[]).includes(value);
}
