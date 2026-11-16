import type { FactorTypeType } from '@/models/Schema';

export type InsightsWindow = '0_12h' | '12_24h' | '24_48h';

export type InsightConfidence = 'low' | 'medium' | 'high';

export type InsightBucketId = 'likely_increases' | 'likely_decreases' | 'no_clear_association';

export type InsightDirection = 'increase' | 'decrease' | 'no_clear';

export type InsightCard = {
  id: string;
  factorId: string;
  factorName: string;
  factorType: FactorTypeType;
  window: InsightsWindow;
  bucket: InsightBucketId;
  direction: InsightDirection;
  // P(exposed | case moments) vs P(exposed | control moments), excluding missing diary coverage
  caseRate: number;
  controlRate: number;
  riskDiff: number;
  riskDiffCi: { low: number; high: number };
  pValue: number;
  qValue: number;
  confidence: InsightConfidence;
  possibleEarlySign: boolean;
  // Basic counts for transparency/uncertainty
  counts: {
    setsUsed: number; // matched sets included (case moments with >=1 valid control)
    controlsPerSetAvg: number;
    caseExposed: number;
    caseTotal: number;
    controlExposed: number;
    controlTotal: number;
  };
};

export type InsightsDataReadiness = {
  diaryDaysRecorded: number;
  diaryDaysTotal: number;
  diaryCoveragePct: number;
  attackStarts: number;
  lastComputedAt: string;
  missing: string[];
};

export type InsightsTrendPoint = {
  weekStart: string; // ISO date
  attackStarts: number;
};

export type InsightsBucket = {
  id: InsightBucketId;
  title: string;
  items: InsightCard[];
};

export type InsightsInputStats = {
  windowDays: number;
  nowUtc: string;
  episodesInWindow: number;
  caseMomentsUsed: number;
  diaryDaysObserved: number;
  factorsTested: number;
  controlsPerCase: number;
  runtimeMs: number;
  exclusions: {
    episodesOutsideWindow: number;
    factorEventsDuringAttack: number;
    candidateControlsRejected: number;
  };
};

export type InsightsPayload = {
  methodVersion: string;
  windowDays: number;
  computedAt: string;
  disclaimer: string;
  status: 'ready' | 'insufficient_data' | 'no_strong_signals';
  dataReadiness: InsightsDataReadiness;
  highlights: InsightCard[];
  buckets: InsightsBucket[];
  trends: {
    weeklyAttackStarts: InsightsTrendPoint[];
  };
  inputStats: InsightsInputStats;
};
