import type { RecommendationTriggerT } from './programDefinitionSchema';
import type { IntakeMedTimingType, IntakeSleepTroubleType } from '@/models/intake';

export type ProgramForEngine = { id: string; triggers: RecommendationTriggerT[] };

export type EngineSignals = {
  factorLogsLast14d: { factor: string; value: string; daysAgo: number }[];
  headacheDaysLast14d: number;
  diaryCoverageLast28d: number; // 0..1
  avgOnsetToDoseMinutesLast28d: number | null;
  acuteMedDaysLast28d: number;
  intake: { sleepTrouble: IntakeSleepTroubleType | null; medTiming: IntakeMedTimingType | null } | null;
};

// Recall-phrased reason text ("You told us...") for every reachable answer.
// Keyed as a `Record` over the full enum so adding a new answer value is a
// compile error here, not a silently wrong sentence in production.
const SLEEP_TROUBLE_REASONS: Record<IntakeSleepTroubleType, string> = {
  often: 'You told us you often have trouble sleeping.',
  sometimes: 'You told us you sometimes have trouble sleeping.',
  rarely: 'You told us you rarely have trouble sleeping.',
};

const MED_TIMING_REASONS: Record<IntakeMedTimingType, string> = {
  'lt30': 'You told us you usually take acute medication within 30 minutes of onset.',
  '30_120': 'You told us you usually take acute medication 30 minutes to 2 hours after onset.',
  'gt120': 'You told us you usually take acute medication more than 2 hours after onset.',
  'varies': 'You told us your acute medication timing varies.',
};

export type EngineInput = {
  programs: ProgramForEngine[];
  enrolledIds: string[];
  dismissedIds: string[];
  signals: EngineSignals;
};

export type RankedProgram = { id: string; reason: string };

function evaluateTrigger(t: RecommendationTriggerT, s: EngineSignals): string | null {
  switch (t.kind) {
    case 'factor-frequency': {
      const matchesValue = (l: { value: string }) =>
        t.values.length === 0 ? true : t.values.includes(l.value);
      const matches = s.factorLogsLast14d.filter(
        l => l.factor === t.factor && matchesValue(l) && l.daysAgo < t.windowDays,
      ).length;
      const valuesLabel = t.values.length === 0 ? '' : ` as ${t.values.join('/')}`;
      return matches >= t.minDays
        ? `Logged ${t.factor}${valuesLabel} ${matches} of last ${t.windowDays} days.`
        : null;
    }
    case 'headache-rate':
      return s.headacheDaysLast14d >= t.minHeadacheDays
        ? `Headache on ${s.headacheDaysLast14d} of last ${t.windowDays} days.`
        : null;
    case 'onset-to-dose':
      return s.avgOnsetToDoseMinutesLast28d !== null && s.avgOnsetToDoseMinutesLast28d > t.averageMinutesAtLeast
        ? `Acute meds averaged ${Math.round(s.avgOnsetToDoseMinutesLast28d)} min after onset.`
        : null;
    case 'acute-med-days':
      return s.acuteMedDaysLast28d >= t.minDays
        ? `Acute meds taken on ${s.acuteMedDaysLast28d} of last ${t.windowDays} days.`
        : null;
    case 'intake-answer': {
      // Provenance matters: this is a recalled answer, not observed data.
      if (t.field === 'sleepTrouble') {
        const answer = s.intake?.sleepTrouble ?? null;
        return answer && t.values.includes(answer) ? SLEEP_TROUBLE_REASONS[answer] : null;
      }
      const answer = s.intake?.medTiming ?? null;
      return answer && t.values.includes(answer) ? MED_TIMING_REASONS[answer] : null;
    }
  }
}

export function rankRecommendations(input: EngineInput): RankedProgram[] {
  const out: RankedProgram[] = [];
  for (const p of input.programs) {
    if (input.enrolledIds.includes(p.id) || input.dismissedIds.includes(p.id)) {
      continue;
    }
    const matched = p.triggers
      .map(t => evaluateTrigger(t, input.signals))
      .filter((m): m is string => Boolean(m));
    if (matched.length > 0) {
      out.push({ id: p.id, reason: matched[0]! });
    }
  }
  return out;
}
