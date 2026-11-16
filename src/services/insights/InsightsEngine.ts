import type {
  InsightCard,
  InsightConfidence,
  InsightsBucket,
  InsightsPayload,
  InsightsWindow,
} from './InsightsTypes';

import type { FactorTypeType } from '@/models/Schema';
import { DateTime } from 'luxon';

import { getLocalDatesOverlappedByRange } from '@/services/outcomes/localDateOverlap';
import { benjaminiHochberg } from './bhFdr';
import { hashStringToSeed32, SeededRng } from './seededRng';

export type EpisodeStart = {
  id: number;
  startTime: Date;
  endTime: Date | null;
  isOngoing: boolean;
};

export type FactorInfo = {
  id: string;
  displayName: string;
  type: FactorTypeType;
};

export type FactorEvent = {
  factorId: string;
  occurredAt: Date;
};

export type InsightsEngineConfig = {
  methodVersion: string;
  windowDays: number;
  // Control moments selection (case-crossover)
  controlsPerCase: number; // K
  controlGuardHours: number; // exclude controls if any episode starts within +/- guard
  // Gating / conservatism
  minCaseMoments: number;
  minDiaryDays: number;
  minAttackStarts: number;
  highConfidenceAttackStarts: number;
  minTotalExposures: number;
  alpha: number; // BH FDR threshold
  maxHighlights: number;
  maxPerBucket: number;
  // Early-sign heuristic
  earlySignCloseHours: number; // e.g. 2 hours before onset
  earlySignShareThreshold: number; // e.g. 0.6
};

export const DEFAULT_INSIGHTS_ENGINE_CONFIG: InsightsEngineConfig = {
  methodVersion: 'f39_v2_cc_wilson_bh_v1',
  windowDays: 90,
  controlsPerCase: 6,
  controlGuardHours: 48,
  minCaseMoments: 6,
  minDiaryDays: 45,
  minAttackStarts: 6,
  highConfidenceAttackStarts: 10,
  minTotalExposures: 6,
  alpha: 0.05,
  maxHighlights: 3,
  maxPerBucket: 12,
  earlySignCloseHours: 2,
  earlySignShareThreshold: 0.6,
};

type WindowSpec = { id: InsightsWindow; fromHours: number; toHours: number };
const WINDOWS: WindowSpec[] = [
  { id: '0_12h', fromHours: 0, toHours: 12 },
  { id: '12_24h', fromHours: 12, toHours: 24 },
  { id: '24_48h', fromHours: 24, toHours: 48 },
];

type MatchedSet = {
  caseMoment: Date;
  controlMoments: Date[];
};

type ExposureSet = {
  // exposures per moment in set; index 0 is case, rest are controls
  // null = missing diary coverage for that moment-window
  exposures: Array<0 | 1 | null>;
  // for early-sign heuristic: for case only, min hours before onset if exposed; null otherwise
  caseMinLagHours: number | null;
};

function msHours(h: number): number {
  return h * 60 * 60 * 1000;
}

function inRange(t: number, start: number, end: number): boolean {
  return t >= start && t < end;
}

function sortAscDates(dates: Date[]): Date[] {
  return [...dates].sort((a, b) => a.getTime() - b.getTime());
}

type AttackWindow = { start: number; end: number };

function episodeEnd(ep: EpisodeStart, nowUtc: Date): Date {
  if (ep.endTime) {
    return ep.endTime;
  }
  return ep.isOngoing ? nowUtc : ep.startTime;
}

function buildAttackWindows(episodes: EpisodeStart[], nowUtc: Date): AttackWindow[] {
  return episodes.map(ep => ({
    start: ep.startTime.getTime(),
    end: episodeEnd(ep, nowUtc).getTime(),
  }));
}

function isWithinAttackWindow(windows: AttackWindow[], t: number): boolean {
  for (const w of windows) {
    if (t >= w.start && t <= w.end) {
      return true;
    }
  }
  return false;
}

function buildAttackStartTimes(episodes: EpisodeStart[]): number[] {
  return episodes.map(ep => ep.startTime.getTime()).sort((a, b) => a - b);
}

function hasAttackStartWithinGuard(sortedStarts: number[], t: number, guardHours: number): boolean {
  const guard = msHours(guardHours);
  const min = t - guard;
  const max = t + guard;
  // binary search for first start >= min
  let lo = 0;
  let hi = sortedStarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedStarts[mid]! < min) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < sortedStarts.length && sortedStarts[lo]! <= max;
}

function buildEventIndex(events: FactorEvent[]): Map<string, number[]> {
  const byFactor = new Map<string, number[]>();
  for (const e of events) {
    const t = e.occurredAt.getTime();
    const arr = byFactor.get(e.factorId) ?? [];
    arr.push(t);
    byFactor.set(e.factorId, arr);
  }
  for (const [k, arr] of byFactor) {
    arr.sort((a, b) => a - b);
    byFactor.set(k, arr);
  }
  return byFactor;
}

function anyEventInWindow(sortedTimes: number[], start: number, end: number): boolean {
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid]! < start) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < sortedTimes.length && sortedTimes[lo]! < end;
}

function factorHasEventInWindow(sortedTimes: number[] | undefined, start: number, end: number): boolean {
  if (!sortedTimes || sortedTimes.length === 0) {
    return false;
  }
  return anyEventInWindow(sortedTimes, start, end);
}

function minLagHoursForFactorInCaseWindow(
  sortedTimes: number[] | undefined,
  windowStart: number,
  windowEnd: number,
  onsetTime: number,
): number | null {
  if (!sortedTimes || sortedTimes.length === 0) {
    return null;
  }
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid]! < windowStart) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  let best: number | null = null;
  for (let i = lo; i < sortedTimes.length; i++) {
    const t = sortedTimes[i]!;
    if (t >= windowEnd) {
      break;
    }
    const lagH = (onsetTime - t) / msHours(1);
    if (lagH >= 0 && (best === null || lagH < best)) {
      best = lagH;
    }
  }
  return best;
}

function candidateMomentForDay(args: {
  localDate: string;
  caseMoment: Date;
  timezone: string;
}): Date | null {
  const caseLocal = DateTime.fromJSDate(args.caseMoment, { zone: args.timezone });
  const dayLocal = DateTime.fromISO(args.localDate, { zone: args.timezone }).set({
    hour: caseLocal.hour,
    minute: caseLocal.minute,
    second: caseLocal.second,
    millisecond: caseLocal.millisecond,
  });
  if (!dayLocal.isValid) {
    return null;
  }
  return dayLocal.toUTC().toJSDate();
}

function pickControlsForCase(args: {
  userId: string;
  cfg: InsightsEngineConfig;
  caseMoment: Date;
  diaryDays: Set<string>;
  timezone: string;
  analysisStart: Date;
  analysisEnd: Date;
  attackWindows: AttackWindow[];
  attackStartsSorted: number[];
}): { controls: Date[]; rejected: number } {
  const candidatesSameDow: Date[] = [];
  const candidatesOther: Date[] = [];
  let rejected = 0;
  const caseLocal = DateTime.fromJSDate(args.caseMoment, { zone: args.timezone });

  for (const ymd of args.diaryDays) {
    const candidate = candidateMomentForDay({
      localDate: ymd,
      caseMoment: args.caseMoment,
      timezone: args.timezone,
    });
    if (!candidate) {
      rejected += 1;
      continue;
    }
    if (!inRange(candidate.getTime(), args.analysisStart.getTime(), args.analysisEnd.getTime())) {
      rejected += 1;
      continue;
    }
    const t = candidate.getTime();
    if (isWithinAttackWindow(args.attackWindows, t)) {
      rejected += 1;
      continue;
    }
    if (hasAttackStartWithinGuard(args.attackStartsSorted, t, args.cfg.controlGuardHours)) {
      rejected += 1;
      continue;
    }
    const candidateLocal = DateTime.fromJSDate(candidate, { zone: args.timezone });
    if (candidateLocal.weekday === caseLocal.weekday) {
      candidatesSameDow.push(candidate);
    } else {
      candidatesOther.push(candidate);
    }
  }

  const pool = candidatesSameDow.length >= args.cfg.controlsPerCase
    ? candidatesSameDow
    : [...candidatesSameDow, ...candidatesOther];

  if (pool.length <= args.cfg.controlsPerCase) {
    return { controls: sortAscDates(pool), rejected };
  }

  const caseT = args.caseMoment.getTime();
  const rng = new SeededRng(hashStringToSeed32(`${args.userId}:controls:${caseT}`));
  const picked: Date[] = [];
  const draft = [...pool];
  while (picked.length < args.cfg.controlsPerCase && draft.length > 0) {
    const idx = rng.int(0, draft.length - 1);
    picked.push(draft[idx]!);
    draft.splice(idx, 1);
  }
  return { controls: sortAscDates(picked), rejected };
}

function buildMatchedSets(args: {
  userId: string;
  cfg: InsightsEngineConfig;
  episodes: EpisodeStart[];
  diaryDays: Set<string>;
  timezone: string;
  analysisStart: Date;
  analysisEnd: Date;
  attackWindows: AttackWindow[];
  attackStartsSorted: number[];
}): { sets: MatchedSet[]; rejected: number } {
  const sets: MatchedSet[] = [];
  let rejected = 0;
  const startT = args.analysisStart.getTime();
  const endT = args.analysisEnd.getTime();
  const caseEpisodes = args.episodes.filter(ep => inRange(ep.startTime.getTime(), startT, endT));

  for (const ep of caseEpisodes) {
    const { controls, rejected: rejectedLocal } = pickControlsForCase({
      userId: args.userId,
      cfg: args.cfg,
      caseMoment: ep.startTime,
      diaryDays: args.diaryDays,
      timezone: args.timezone,
      analysisStart: args.analysisStart,
      analysisEnd: args.analysisEnd,
      attackWindows: args.attackWindows,
      attackStartsSorted: args.attackStartsSorted,
    });
    rejected += rejectedLocal;
    if (controls.length === 0) {
      continue;
    }
    sets.push({ caseMoment: ep.startTime, controlMoments: controls });
  }

  return { sets, rejected };
}

function windowCovered(args: {
  windowStart: number;
  windowEnd: number;
  diaryDays: Set<string>;
  timezone: string;
}): boolean {
  const overlapped = getLocalDatesOverlappedByRange({
    start: new Date(args.windowStart),
    end: new Date(args.windowEnd),
    timezone: args.timezone,
  });
  for (const d of overlapped) {
    if (!args.diaryDays.has(d)) {
      return false;
    }
  }
  return true;
}

function computeExposureSetForFactorWindow(
  factorTimes: number[] | undefined,
  diaryDays: Set<string>,
  timezone: string,
  window: WindowSpec,
  set: MatchedSet,
): ExposureSet {
  const onset = set.caseMoment.getTime();
  const wStart = onset - msHours(window.toHours);
  const wEnd = onset - msHours(window.fromHours);
  const caseCovered = windowCovered({ windowStart: wStart, windowEnd: wEnd, diaryDays, timezone });
  const caseExposed = caseCovered ? (factorHasEventInWindow(factorTimes, wStart, wEnd) ? 1 : 0) : null;
  const caseMinLag = caseCovered
    ? minLagHoursForFactorInCaseWindow(factorTimes, wStart, wEnd, onset)
    : null;

  const exposures: Array<0 | 1 | null> = [caseExposed];
  for (const cm of set.controlMoments) {
    const t = cm.getTime();
    const cs = t - msHours(window.toHours);
    const ce = t - msHours(window.fromHours);
    const covered = windowCovered({ windowStart: cs, windowEnd: ce, diaryDays, timezone });
    exposures.push(covered ? (factorHasEventInWindow(factorTimes, cs, ce) ? 1 : 0) : null);
  }
  return { exposures, caseMinLagHours: caseMinLag };
}

function wilsonInterval(successes: number, total: number): { low: number; high: number } {
  if (total <= 0) {
    return { low: 0, high: 1 };
  }
  const z = 1.96;
  const n = total;
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const radius = (z / denom) * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, center - radius),
    high: Math.min(1, center + radius),
  };
}

const logFactCache: number[] = [0];
function logFactorial(n: number): number {
  if (n < 0) {
    return Number.NEGATIVE_INFINITY;
  }
  for (let i = logFactCache.length; i <= n; i++) {
    logFactCache[i] = logFactCache[i - 1]! + Math.log(i);
  }
  return logFactCache[n]!;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) {
    return Number.NEGATIVE_INFINITY;
  }
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function fisherExactPValue(args: {
  caseExposed: number;
  caseTotal: number;
  controlExposed: number;
  controlTotal: number;
}): number {
  const aObs = args.caseExposed;
  const bObs = args.caseTotal - args.caseExposed;
  const cObs = args.controlExposed;
  const dObs = args.controlTotal - args.controlExposed;
  const row1 = args.caseTotal;
  const row2 = args.controlTotal;
  const col1 = aObs + cObs;
  const col2 = bObs + dObs;
  const total = row1 + row2;

  const minA = Math.max(0, col1 - row2);
  const maxA = Math.min(col1, row1);

  const logDenom = logChoose(total, row1);
  const probForA = (a: number) => {
    const b = row1 - a;
    const c = col1 - a;
    const d = row2 - c;
    if (b < 0 || c < 0 || d < 0) {
      return 0;
    }
    const logP = logChoose(col1, a) + logChoose(col2, b) - logDenom;
    return Math.exp(logP);
  };

  const pObs = probForA(aObs);
  let pValue = 0;
  for (let a = minA; a <= maxA; a++) {
    const p = probForA(a);
    if (p <= pObs + 1e-12) {
      pValue += p;
    }
  }
  return Math.min(1, Math.max(0, pValue));
}

function confidenceLabel(args: {
  cfg: InsightsEngineConfig;
  attackStarts: number;
  ciExcludesZero: boolean;
  qValue: number;
}): InsightConfidence {
  if (
    args.attackStarts >= args.cfg.highConfidenceAttackStarts
    && args.ciExcludesZero
    && args.qValue <= args.cfg.alpha
  ) {
    return 'high';
  }
  if (args.attackStarts >= args.cfg.minAttackStarts && (args.ciExcludesZero || args.qValue <= args.cfg.alpha)) {
    return 'medium';
  }
  return 'low';
}

export type InsightsEngineResult
  = | { status: 'ok'; payload: InsightsPayload }
    | {
      status: 'insufficient_data';
      reason:
        | 'not_enough_cases'
        | 'not_enough_diary_days'
        | 'no_factors'
        | 'no_valid_controls';
      payload: InsightsPayload;
    }
    | { status: 'no_strong_signals'; payload: InsightsPayload };

export function computeInsightsForUser(params: {
  userId: string;
  nowUtc: Date;
  cfg: InsightsEngineConfig;
  episodes: EpisodeStart[];
  factors: FactorInfo[];
  factorEvents: FactorEvent[];
  diaryEntries: Array<{ localDate: string }>;
  timezone: string;
}): InsightsEngineResult {
  const startedAt = Date.now();
  const { userId, nowUtc, cfg, episodes, factors, factorEvents, diaryEntries, timezone } = params;

  const analysisStart = new Date(nowUtc.getTime() - cfg.windowDays * 24 * 60 * 60 * 1000);
  const analysisEnd = nowUtc;
  const analysisEndLocal = DateTime.fromJSDate(nowUtc, { zone: timezone }).startOf('day');
  const analysisStartLocal = analysisEndLocal.minus({ days: cfg.windowDays - 1 });

  const diaryDays = new Set(diaryEntries.map(e => e.localDate));
  const diaryDaysObserved = diaryDays.size;
  const diaryDaysTotal = cfg.windowDays;
  const diaryCoveragePct = diaryDaysTotal > 0 ? diaryDaysObserved / diaryDaysTotal : 0;

  const episodesInWindow = episodes.filter(ep => ep.startTime >= analysisStart && ep.startTime <= analysisEnd);
  const attackStarts = episodesInWindow.length;

  const missing: string[] = [];
  if (diaryDaysObserved < cfg.minDiaryDays) {
    missing.push('More diary-complete days');
  }
  if (attackStarts < cfg.minAttackStarts) {
    missing.push('More attack starts');
  }

  const disclaimer
    = 'These are conservative associations in your data. They might be coincidence, and the app cannot determine cause and effect or give medical advice.';

  const trendsWeekly = (() => {
    const counts = new Map<string, number>();
    for (const ep of episodesInWindow) {
      const weekStart = DateTime.fromJSDate(ep.startTime, { zone: timezone })
        .startOf('week')
        .toISODate()!;
      counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
    }
    const out: Array<{ weekStart: string; attackStarts: number }> = [];
    let cursor = analysisStartLocal.startOf('week');
    const endCursor = analysisEndLocal.startOf('week');
    while (cursor <= endCursor) {
      const key = cursor.toISODate()!;
      out.push({ weekStart: key, attackStarts: counts.get(key) ?? 0 });
      cursor = cursor.plus({ weeks: 1 });
    }
    return out;
  })();

  const basePayload: InsightsPayload = {
    methodVersion: cfg.methodVersion,
    windowDays: cfg.windowDays,
    computedAt: nowUtc.toISOString(),
    disclaimer,
    status: 'ready',
    dataReadiness: {
      diaryDaysRecorded: diaryDaysObserved,
      diaryDaysTotal,
      diaryCoveragePct,
      attackStarts,
      lastComputedAt: nowUtc.toISOString(),
      missing,
    },
    highlights: [],
    buckets: [
      { id: 'likely_increases', title: 'Likely increases risk', items: [] },
      { id: 'likely_decreases', title: 'Likely decreases risk', items: [] },
      { id: 'no_clear_association', title: 'No clear association', items: [] },
    ],
    trends: {
      weeklyAttackStarts: trendsWeekly,
    },
    inputStats: {
      windowDays: cfg.windowDays,
      nowUtc: nowUtc.toISOString(),
      episodesInWindow: episodesInWindow.length,
      caseMomentsUsed: 0,
      diaryDaysObserved,
      factorsTested: 0,
      controlsPerCase: cfg.controlsPerCase,
      runtimeMs: 0,
      exclusions: {
        episodesOutsideWindow: Math.max(episodes.length - episodesInWindow.length, 0),
        factorEventsDuringAttack: 0,
        candidateControlsRejected: 0,
      },
    },
  };

  if (diaryDaysObserved < cfg.minDiaryDays) {
    basePayload.status = 'insufficient_data';
    basePayload.inputStats.runtimeMs = Date.now() - startedAt;
    return { status: 'insufficient_data', reason: 'not_enough_diary_days', payload: basePayload };
  }
  if (attackStarts < cfg.minAttackStarts) {
    basePayload.status = 'insufficient_data';
    basePayload.inputStats.runtimeMs = Date.now() - startedAt;
    return { status: 'insufficient_data', reason: 'not_enough_cases', payload: basePayload };
  }

  const attackWindows = buildAttackWindows(episodes, nowUtc);
  const attackStartsSorted = buildAttackStartTimes(episodes);

  const eventsInWindow = factorEvents.filter(e => e.occurredAt >= analysisStart && e.occurredAt <= analysisEnd);
  const eventsOutsideAttack = eventsInWindow.filter(e => !isWithinAttackWindow(attackWindows, e.occurredAt.getTime()));
  basePayload.inputStats.exclusions.factorEventsDuringAttack = eventsInWindow.length - eventsOutsideAttack.length;

  const factorIndex = new Map(factors.map(f => [f.id, f] as const));
  const factorIds = Array.from(new Set(eventsOutsideAttack.map(e => e.factorId))).filter(id => factorIndex.has(id));
  basePayload.inputStats.factorsTested = factorIds.length * WINDOWS.length;

  if (factorIds.length === 0) {
    basePayload.status = 'insufficient_data';
    basePayload.inputStats.runtimeMs = Date.now() - startedAt;
    return { status: 'insufficient_data', reason: 'no_factors', payload: basePayload };
  }

  const byFactorTimes = buildEventIndex(eventsOutsideAttack);

  const { sets: matchedSets, rejected } = buildMatchedSets({
    userId,
    cfg,
    episodes,
    diaryDays,
    timezone,
    analysisStart,
    analysisEnd,
    attackWindows,
    attackStartsSorted,
  });
  basePayload.inputStats.caseMomentsUsed = matchedSets.length;
  basePayload.inputStats.exclusions.candidateControlsRejected = rejected;

  if (matchedSets.length < cfg.minCaseMoments) {
    basePayload.status = 'insufficient_data';
    basePayload.inputStats.runtimeMs = Date.now() - startedAt;
    return { status: 'insufficient_data', reason: 'no_valid_controls', payload: basePayload };
  }

  type RawCandidate = {
    factorId: string;
    window: InsightsWindow;
    pValue: number;
    qValue: number;
    caseRate: number;
    controlRate: number;
    riskDiff: number;
    riskDiffCi: { low: number; high: number };
    counts: InsightCard['counts'];
    totalExposures: number;
    possibleEarlySign: boolean;
    ciExcludesZero: boolean;
  };

  const byWindow = new Map<InsightsWindow, RawCandidate[]>();

  for (const w of WINDOWS) {
    const temp: Array<Omit<RawCandidate, 'qValue'>> = [];
    const pValues: number[] = [];

    for (const fid of factorIds) {
      const exposuresBySet: ExposureSet[] = matchedSets.map(set =>
        computeExposureSetForFactorWindow(byFactorTimes.get(fid), diaryDays, timezone, w, set),
      );

      let setsUsed = 0;
      let controlsTotal = 0;
      let controlsExposed = 0;
      let caseTotal = 0;
      let caseExposed = 0;
      let controlsPerSetSum = 0;
      let earlySignExposedCases = 0;
      let earlySignCloseCases = 0;

      for (const s of exposuresBySet) {
        const caseV = s.exposures[0];
        if (caseV == null) {
          continue;
        }
        const observedControls = s.exposures.slice(1).filter((x): x is 0 | 1 => x != null);
        if (observedControls.length === 0) {
          continue;
        }

        setsUsed++;
        caseTotal++;
        caseExposed += caseV;
        controlsPerSetSum += observedControls.length;
        controlsTotal += observedControls.length;
        controlsExposed += observedControls.reduce<number>((a, x) => a + x, 0);

        if (caseV === 1) {
          earlySignExposedCases++;
          if (s.caseMinLagHours != null && s.caseMinLagHours <= cfg.earlySignCloseHours) {
            earlySignCloseCases++;
          }
        }
      }

      if (setsUsed < cfg.minCaseMoments) {
        continue;
      }

      const totalExposures = caseExposed + controlsExposed;
      if (totalExposures < cfg.minTotalExposures) {
        continue;
      }

      const caseRate = caseTotal > 0 ? caseExposed / caseTotal : 0;
      const controlRate = controlsTotal > 0 ? controlsExposed / controlsTotal : 0;
      const riskDiff = caseRate - controlRate;
      const caseCi = wilsonInterval(caseExposed, caseTotal);
      const controlCi = wilsonInterval(controlsExposed, controlsTotal);
      const riskDiffCi = { low: caseCi.low - controlCi.high, high: caseCi.high - controlCi.low };
      const ciExcludesZero = riskDiffCi.low > 0 || riskDiffCi.high < 0;

      const pValue = fisherExactPValue({
        caseExposed,
        caseTotal,
        controlExposed: controlsExposed,
        controlTotal: controlsTotal,
      });

      const info = factorIndex.get(fid)!;
      const possibleEarlySign
        = info.type === 'symptom'
          || (earlySignExposedCases > 0 && earlySignCloseCases / earlySignExposedCases >= cfg.earlySignShareThreshold);

      const counts: InsightCard['counts'] = {
        setsUsed,
        controlsPerSetAvg: setsUsed > 0 ? controlsPerSetSum / setsUsed : 0,
        caseExposed,
        caseTotal,
        controlExposed: controlsExposed,
        controlTotal: controlsTotal,
      };

      temp.push({
        factorId: fid,
        window: w.id,
        pValue,
        caseRate,
        controlRate,
        riskDiff,
        riskDiffCi,
        counts,
        totalExposures,
        possibleEarlySign,
        ciExcludesZero,
      });
      pValues.push(pValue);
    }

    if (temp.length > 0) {
      const { qValues } = benjaminiHochberg(pValues);
      const enriched = temp.map((c, idx) => ({
        ...(c as Omit<RawCandidate, 'qValue'>),
        qValue: qValues[idx] ?? 1,
      }));
      byWindow.set(w.id, enriched);
    }
  }

  const allCandidates = Array.from(byWindow.values()).flat();
  if (allCandidates.length === 0) {
    basePayload.status = 'no_strong_signals';
    basePayload.inputStats.runtimeMs = Date.now() - startedAt;
    return { status: 'no_strong_signals', payload: basePayload };
  }

  const byFactor = new Map<string, RawCandidate[]>();
  for (const c of allCandidates) {
    const arr = byFactor.get(c.factorId) ?? [];
    arr.push(c);
    byFactor.set(c.factorId, arr);
  }

  const increases: InsightCard[] = [];
  const decreases: InsightCard[] = [];
  const noClear: InsightCard[] = [];

  for (const [fid, list] of byFactor) {
    const info = factorIndex.get(fid)!;
    const signals = list.filter(c => c.ciExcludesZero || c.qValue <= cfg.alpha);
    const signalOutsideZero12h = list.some(c =>
      c.window !== '0_12h' && (c.ciExcludesZero || c.qValue <= cfg.alpha),
    );

    if (signals.length === 0) {
      const best = [...list].sort((a, b) => b.totalExposures - a.totalExposures)[0]!;
      const confidence = confidenceLabel({
        cfg,
        attackStarts,
        ciExcludesZero: false,
        qValue: best.qValue,
      });
      if (confidence !== 'low') {
        noClear.push({
          id: `${fid}:${best.window}`,
          factorId: fid,
          factorName: info.displayName,
          factorType: info.type,
          window: best.window,
          bucket: 'no_clear_association',
          direction: 'no_clear',
          caseRate: best.caseRate,
          controlRate: best.controlRate,
          riskDiff: best.riskDiff,
          riskDiffCi: best.riskDiffCi,
          pValue: best.pValue,
          qValue: best.qValue,
          confidence,
          possibleEarlySign: false,
          counts: best.counts,
        });
      }
      continue;
    }

    for (const s of signals) {
      let confidence = confidenceLabel({
        cfg,
        attackStarts,
        ciExcludesZero: s.ciExcludesZero,
        qValue: s.qValue,
      });

      const possibleEarlySign = s.possibleEarlySign && s.window === '0_12h' && !signalOutsideZero12h;
      if (possibleEarlySign && confidence === 'high') {
        confidence = 'medium';
      } else if (possibleEarlySign && confidence === 'medium') {
        confidence = 'low';
      }

      const direction = s.riskDiff >= 0 ? 'increase' : 'decrease';
      const card: InsightCard = {
        id: `${fid}:${s.window}`,
        factorId: fid,
        factorName: info.displayName,
        factorType: info.type,
        window: s.window,
        bucket: direction === 'increase' ? 'likely_increases' : 'likely_decreases',
        direction,
        caseRate: s.caseRate,
        controlRate: s.controlRate,
        riskDiff: s.riskDiff,
        riskDiffCi: s.riskDiffCi,
        pValue: s.pValue,
        qValue: s.qValue,
        confidence,
        possibleEarlySign,
        counts: s.counts,
      };

      if (confidence === 'low') {
        continue;
      }
      if (direction === 'increase') {
        increases.push(card);
      } else {
        decreases.push(card);
      }
    }
  }

  const sortByConfidence = (a: InsightCard, b: InsightCard) => {
    const rank = (c: InsightConfidence) => (c === 'high' ? 2 : c === 'medium' ? 1 : 0);
    if (rank(a.confidence) !== rank(b.confidence)) {
      return rank(b.confidence) - rank(a.confidence);
    }
    if (a.qValue !== b.qValue) {
      return a.qValue - b.qValue;
    }
    return Math.abs(b.riskDiff) - Math.abs(a.riskDiff);
  };

  increases.sort(sortByConfidence);
  decreases.sort(sortByConfidence);
  noClear.sort((a, b) => b.counts.caseTotal - a.counts.caseTotal);

  const highlights = [...increases, ...decreases]
    .filter(c => c.factorType === 'trigger' || c.factorType === 'protector')
    .sort(sortByConfidence)
    .slice(0, cfg.maxHighlights);

  const buckets: InsightsBucket[] = [
    { id: 'likely_increases', title: 'Likely increases risk', items: increases.slice(0, cfg.maxPerBucket) },
    { id: 'likely_decreases', title: 'Likely decreases risk', items: decreases.slice(0, cfg.maxPerBucket) },
    { id: 'no_clear_association', title: 'No clear association', items: noClear.slice(0, cfg.maxPerBucket) },
  ];

  const payload: InsightsPayload = {
    ...basePayload,
    status: increases.length + decreases.length === 0 ? 'no_strong_signals' : 'ready',
    highlights,
    buckets,
    inputStats: {
      ...basePayload.inputStats,
      runtimeMs: Date.now() - startedAt,
    },
  };

  if (payload.status === 'no_strong_signals') {
    return { status: 'no_strong_signals', payload };
  }

  return { status: 'ok', payload };
}
