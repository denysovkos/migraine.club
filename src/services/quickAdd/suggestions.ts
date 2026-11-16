import type { QuickAddSuggestion } from '@/types/Medications';

export type IntakeEvent = {
  userMedicationId: string;
  takenAt: Date;
  dose: string | null;
  unit: string | null;
  unitIsCustom: boolean;
};

export type UserMedicationInfo = {
  userMedicationId: string;
  label: string;
  defaultDose: string | null;
  defaultUnit: string | null;
  defaultUnitIsCustom: boolean;
};

function daysAgoUtc(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function mostCommonDoseUnit(entries: Array<{ dose: string | null; unit: string | null; unitIsCustom: boolean }>): {
  dose: string | null;
  unit: string | null;
  unitIsCustom: boolean;
} | null {
  const key = (e: { dose: string | null; unit: string | null; unitIsCustom: boolean }) =>
    `${e.dose ?? ''}||${e.unit ?? ''}||${e.unitIsCustom ? '1' : '0'}`;

  const counts = new Map<string, { e: { dose: string | null; unit: string | null; unitIsCustom: boolean }; n: number }>();
  for (const e of entries) {
    if (!e.dose && !e.unit) {
      continue;
    }
    const k = key(e);
    const prev = counts.get(k);
    if (prev) {
      prev.n += 1;
    } else {
      counts.set(k, { e, n: 1 });
    }
  }
  if (counts.size === 0) {
    return null;
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]!.e;
}

function pickSuggestedDoseUnit(args: {
  defaults: { dose: string | null; unit: string | null; unitIsCustom: boolean };
  intakesNewestFirst: Array<{ dose: string | null; unit: string | null; unitIsCustom: boolean }>;
}): { dose: string | null; unit: string | null; unitIsCustom: boolean } {
  // 1) user default
  if (args.defaults.dose || args.defaults.unit) {
    return args.defaults;
  }

  // 2) mode in 90d
  const mode = mostCommonDoseUnit(args.intakesNewestFirst);
  if (mode) {
    return mode;
  }

  // 3) last used in 90d
  const last = args.intakesNewestFirst.find(r => !!r.dose || !!r.unit);
  if (last) {
    return last;
  }

  return { dose: null, unit: null, unitIsCustom: false };
}

export function computeTopSuggestions(args: {
  now: Date;
  intakes: IntakeEvent[];
  meds: UserMedicationInfo[];
  windowDays?: number;
  limit?: number;
}): QuickAddSuggestion[] {
  const windowDays = args.windowDays ?? 90;
  const limit = args.limit ?? 5;
  const windowStart = daysAgoUtc(args.now, windowDays);

  const within = args.intakes.filter(i => i.takenAt >= windowStart && i.takenAt <= args.now);

  const grouped = new Map<string, { count: number; lastUsedAt: Date }>();
  for (const i of within) {
    const prev = grouped.get(i.userMedicationId);
    if (!prev) {
      grouped.set(i.userMedicationId, { count: 1, lastUsedAt: i.takenAt });
    } else {
      prev.count += 1;
      if (i.takenAt > prev.lastUsedAt) {
        prev.lastUsedAt = i.takenAt;
      }
    }
  }

  const ordered = [...grouped.entries()]
    .map(([userMedicationId, v]) => ({ userMedicationId, ...v }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    })
    .slice(0, limit);

  const medById = new Map(args.meds.map(m => [m.userMedicationId, m]));

  const suggestions: QuickAddSuggestion[] = [];
  for (const g of ordered) {
    const med = medById.get(g.userMedicationId);
    if (!med) {
      continue;
    }

    const intakesNewestFirst = within
      .filter(i => i.userMedicationId === g.userMedicationId)
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
      .map(i => ({ dose: i.dose, unit: i.unit, unitIsCustom: i.unitIsCustom }));

    const suggested = pickSuggestedDoseUnit({
      defaults: {
        dose: med.defaultDose,
        unit: med.defaultUnit,
        unitIsCustom: med.defaultUnitIsCustom,
      },
      intakesNewestFirst,
    });

    suggestions.push({
      userMedicationId: g.userMedicationId,
      label: med.label,
      suggestedDose: suggested.dose,
      suggestedUnit: suggested.unit,
      unitIsCustom: suggested.unitIsCustom,
      lastUsedAt: g.lastUsedAt.toISOString(),
      score: g.count * 1_000_000 + g.lastUsedAt.getTime(),
    });
  }

  return suggestions;
}
