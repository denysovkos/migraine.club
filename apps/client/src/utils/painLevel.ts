export type PainLevel = 1 | 2 | 3 | 4 | 5;

export type PainLevelMeta = {
  value: PainLevel;
  /** UI display for the number badge */
  display: string;
  /** Short label (for compact badges) */
  shortLabel: string;
  /** Full label */
  label: string;
  /** Tailwind classes for colored badges / accents */
  colorClasses: {
    badge: string;
    ring: string;
    icon: string;
  };
};

/**
 * Normalize legacy stored episode intensity values (0–10) into the new 1–5 pain level.
 *
 * Mapping:
 * - 0 -> null (unknown / invalid for episodes)
 * - 1–2 -> 1
 * - 3–4 -> 2
 * - 5–6 -> 3
 * - 7–8 -> 4
 * - 9–10 -> 5
 *
 * If the input is already 1–5, it is returned as-is.
 */
export function normalizeToPainLevel(
  value: number | null | undefined,
): PainLevel | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  if (value >= 1 && value <= 5) {
    return value as PainLevel;
  }

  if (value === 0) {
    return null;
  }

  if (value >= 1 && value <= 2) {
    return 1;
  }
  if (value >= 3 && value <= 4) {
    return 2;
  }
  if (value >= 5 && value <= 6) {
    return 3;
  }
  if (value >= 7 && value <= 8) {
    return 4;
  }
  if (value >= 9 && value <= 10) {
    return 5;
  }

  return null;
}

export function painLevelDisplay(level: PainLevel): string {
  return level === 5 ? '5+' : String(level);
}

export function painLevelMeta(level: PainLevel): PainLevelMeta {
  switch (level) {
    case 1:
      return {
        value: 1,
        display: '1',
        shortLabel: 'Mild',
        label: 'Mild',
        colorClasses: {
          badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
          ring: 'ring-emerald-400/40 dark:ring-emerald-300/25',
          icon: 'text-emerald-700 dark:text-emerald-200',
        },
      };
    case 2:
      return {
        value: 2,
        display: '2',
        shortLabel: 'Mild+',
        label: 'Mild+',
        colorClasses: {
          badge: 'bg-lime-100 text-lime-950 dark:bg-lime-950 dark:text-lime-50',
          ring: 'ring-lime-400/40 dark:ring-lime-300/25',
          icon: 'text-lime-800 dark:text-lime-200',
        },
      };
    case 3:
      return {
        value: 3,
        display: '3',
        shortLabel: 'Moderate',
        label: 'Moderate',
        colorClasses: {
          badge: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-50',
          ring: 'ring-amber-400/40 dark:ring-amber-300/25',
          icon: 'text-amber-900 dark:text-amber-200',
        },
      };
    case 4:
      return {
        value: 4,
        display: '4',
        shortLabel: 'Severe',
        label: 'Severe',
        colorClasses: {
          badge: 'bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-50',
          ring: 'ring-orange-400/40 dark:ring-orange-300/25',
          icon: 'text-orange-900 dark:text-orange-200',
        },
      };
    case 5:
      return {
        value: 5,
        display: '5+',
        shortLabel: 'Very severe',
        label: 'Very severe',
        colorClasses: {
          badge: 'bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-50',
          ring: 'ring-red-400/40 dark:ring-red-300/25',
          icon: 'text-red-900 dark:text-red-200',
        },
      };
  }
}

export const PAIN_LEVELS: readonly PainLevel[] = [1, 2, 3, 4, 5] as const;
