export type AttackType = 'migraine' | 'headache';

const KEY = 'migraineClub:lastAttackType';

export function getLastAttackType(): AttackType | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(KEY);
  return raw === 'headache' || raw === 'migraine' ? raw : null;
}

export function setLastAttackType(type: AttackType): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(KEY, type);
}
