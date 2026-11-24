import type { PainLevel } from '@/utils/painLevel';

/**
 * Attack mode offers three pain choices instead of the 1–5 picker. Each maps
 * onto the stored 1–5 level whose label matches the word on the button
 * (see painLevelMeta), so the attack page later shows what was tapped.
 */
export type AttackPainChoice = 'mild' | 'moderate' | 'severe';

export const ATTACK_PAIN_CHOICES: readonly AttackPainChoice[] = ['mild', 'moderate', 'severe'] as const;

const INTENSITY_BY_CHOICE: Record<AttackPainChoice, PainLevel> = {
  mild: 1,
  moderate: 3,
  severe: 4,
};

export function painChoiceToIntensity(choice: AttackPainChoice): PainLevel {
  return INTENSITY_BY_CHOICE[choice];
}

/** The choice a stored 1–5 level falls under, or null when unknown. */
export function intensityToPainChoice(intensity: number | null | undefined): AttackPainChoice | null {
  if (intensity == null || !Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    return null;
  }
  if (intensity <= 2) {
    return 'mild';
  }
  if (intensity === 3) {
    return 'moderate';
  }
  return 'severe';
}

/** Attack mode shows at most this many medication buttons. */
export const ATTACK_MODE_MAX_MEDS = 3;

export function limitMeds<T>(meds: readonly T[]): T[] {
  return meds.slice(0, ATTACK_MODE_MAX_MEDS);
}

export function formatDose(dose: string | null | undefined, unit: string | null | undefined): string {
  return [dose, unit].filter(v => typeof v === 'string' && v.trim().length > 0).join(' ');
}

export const ATTACK_MODE_PATH = '/quick/attack';

/** True on the attack mode screen, with or without a locale prefix. */
export function isAttackModePath(pathname: string | null | undefined): boolean {
  return !!pathname && /^(?:\/[a-z]{2})?\/quick\/attack\/?$/.test(pathname);
}
