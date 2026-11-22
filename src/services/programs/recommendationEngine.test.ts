import type { ProgramForEngine } from './recommendationEngine';

import { describe, expect, it } from 'vitest';
import { getProgramDefinitions } from './programDefinitions';
import { rankRecommendations } from './recommendationEngine';

const sleepProgram: ProgramForEngine = {
  id: 'sleep-regularity',
  triggers: [
    { kind: 'factor-frequency', factor: 'sleep_issue', values: [], minDays: 5, windowDays: 14 },
    { kind: 'headache-rate', minHeadacheDays: 4, windowDays: 14 },
  ],
};

const baseSignals = {
  factorLogsLast14d: [],
  headacheDaysLast14d: 1,
  diaryCoverageLast28d: 0.8,
  avgOnsetToDoseMinutesLast28d: null,
  acuteMedDaysLast28d: 0,
  intake: null,
};

describe('rankRecommendations', () => {
  it('recommends sleep when poor-sleep factor logged 5+ in 14d', () => {
    const ranked = rankRecommendations({
      programs: [sleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: {
        ...baseSignals,
        factorLogsLast14d: Array.from({ length: 5 }, (_, i) => ({
          factor: 'sleep_issue',
          value: '',
          daysAgo: i,
        })),
      },
    });

    expect(ranked.map(r => r.id)).toContain('sleep-regularity');
  });

  it('recommends sleep when headache rate ≥ 4 in last 14 days', () => {
    const ranked = rankRecommendations({
      programs: [sleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, headacheDaysLast14d: 5 },
    });

    expect(ranked.map(r => r.id)).toContain('sleep-regularity');
  });

  it('skips program if user already enrolled', () => {
    const ranked = rankRecommendations({
      programs: [sleepProgram],
      enrolledIds: ['sleep-regularity'],
      dismissedIds: [],
      signals: { ...baseSignals, headacheDaysLast14d: 10 },
    });

    expect(ranked).toHaveLength(0);
  });

  it('skips program if dismissed within cooldown', () => {
    const ranked = rankRecommendations({
      programs: [sleepProgram],
      enrolledIds: [],
      dismissedIds: ['sleep-regularity'],
      signals: { ...baseSignals, headacheDaysLast14d: 10 },
    });

    expect(ranked).toHaveLength(0);
  });

  it('returns empty list when no triggers match', () => {
    const ranked = rankRecommendations({
      programs: [sleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: baseSignals,
    });

    expect(ranked).toHaveLength(0);
  });
});

describe('intake-answer trigger', () => {
  const intakeSleepProgram: ProgramForEngine = {
    id: 'sleep-regularity',
    triggers: [
      { kind: 'factor-frequency', factor: 'sleep_issue', values: [], minDays: 5, windowDays: 14 },
      { kind: 'intake-answer', field: 'sleepTrouble', values: ['often', 'sometimes'] },
    ],
  };

  it('recommends from a self-reported answer when no logged data exists', () => {
    const ranked = rankRecommendations({
      programs: [intakeSleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, intake: { sleepTrouble: 'often', medTiming: null } },
    });

    expect(ranked.map(r => r.id)).toContain('sleep-regularity');
    expect(ranked[0]!.reason).toContain('You told us');
  });

  it('does not match when the answer is outside the trigger values', () => {
    const ranked = rankRecommendations({
      programs: [intakeSleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, intake: { sleepTrouble: 'rarely', medTiming: null } },
    });

    expect(ranked).toHaveLength(0);
  });

  it('does not match when the user never completed intake', () => {
    const ranked = rankRecommendations({
      programs: [intakeSleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, intake: null },
    });

    expect(ranked).toHaveLength(0);
  });

  it('prefers the measured reason over the self-reported one once data exists', () => {
    const ranked = rankRecommendations({
      programs: [intakeSleepProgram],
      enrolledIds: [],
      dismissedIds: [],
      signals: {
        ...baseSignals,
        factorLogsLast14d: Array.from({ length: 5 }, (_, i) => ({
          factor: 'sleep_issue',
          value: '',
          daysAgo: i,
        })),
        intake: { sleepTrouble: 'often', medTiming: null },
      },
    });

    expect(ranked[0]!.reason).toContain('Logged sleep_issue');
    expect(ranked[0]!.reason).not.toContain('You told us');
  });
});

describe('intake-answer reason text', () => {
  // Every reachable field/value combination must produce an exact,
  // recall-phrased sentence — never data phrased as if it were observed.
  const sleepProgramFor = (values: ('often' | 'sometimes' | 'rarely')[]): ProgramForEngine => ({
    id: 'sleep-regularity',
    triggers: [{ kind: 'intake-answer', field: 'sleepTrouble', values }],
  });

  const medProgramFor = (values: ('lt30' | '30_120' | 'gt120' | 'varies')[]): ProgramForEngine => ({
    id: 'acute-med-timing',
    triggers: [{ kind: 'intake-answer', field: 'medTiming', values }],
  });

  it.each([
    ['often', 'You told us you often have trouble sleeping.'],
    ['sometimes', 'You told us you sometimes have trouble sleeping.'],
    ['rarely', 'You told us you rarely have trouble sleeping.'],
  ] as const)('sleepTrouble=%s produces the exact reason text', (value, expected) => {
    const ranked = rankRecommendations({
      programs: [sleepProgramFor([value])],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, intake: { sleepTrouble: value, medTiming: null } },
    });

    expect(ranked[0]!.reason).toBe(expected);
  });

  it.each([
    ['lt30', 'You told us you usually take acute medication within 30 minutes of onset.'],
    ['30_120', 'You told us you usually take acute medication 30 minutes to 2 hours after onset.'],
    ['gt120', 'You told us you usually take acute medication more than 2 hours after onset.'],
    ['varies', 'You told us your acute medication timing varies.'],
  ] as const)('medTiming=%s produces the exact reason text', (value, expected) => {
    const ranked = rankRecommendations({
      programs: [medProgramFor([value])],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...baseSignals, intake: { sleepTrouble: null, medTiming: value } },
    });

    expect(ranked[0]!.reason).toBe(expected);
  });
});

describe('program content: intake-answer trigger ordering', () => {
  // The binding constraint is that measured signals outrank self-reported
  // ones. `rankRecommendations` picks `matched[0]` as the reason, so this
  // only holds if `intake-answer` is the LAST trigger in the real content
  // files — not just in a hand-built test fixture that could drift from them.
  it('is the last trigger in sleep-regularity and acute-med-timing', () => {
    const defs = getProgramDefinitions();
    const sleep = defs.find(d => d.frontmatter.id === 'sleep-regularity');
    const acuteMed = defs.find(d => d.frontmatter.id === 'acute-med-timing');

    expect(sleep?.frontmatter.recommendationTriggers.at(-1)?.kind).toBe('intake-answer');
    expect(acuteMed?.frontmatter.recommendationTriggers.at(-1)?.kind).toBe('intake-answer');
  });

  it('lets the measured signal win over the self-reported one using the real loaded triggers', () => {
    const defs = getProgramDefinitions();
    const sleep = defs.find(d => d.frontmatter.id === 'sleep-regularity')!;
    const program: ProgramForEngine = {
      id: sleep.frontmatter.id,
      triggers: sleep.frontmatter.recommendationTriggers,
    };

    const ranked = rankRecommendations({
      programs: [program],
      enrolledIds: [],
      dismissedIds: [],
      signals: {
        ...baseSignals,
        factorLogsLast14d: Array.from({ length: 5 }, (_, i) => ({
          factor: 'sleep_issue',
          value: '',
          daysAgo: i,
        })),
        intake: { sleepTrouble: 'often', medTiming: null },
      },
    });

    expect(ranked[0]!.reason).toContain('Logged sleep_issue');
    expect(ranked[0]!.reason).not.toContain('You told us');
  });
});

describe('factor-frequency counts days, not events', () => {
  const program = { id: 'sleep-regularity', triggers: [{ kind: 'factor-frequency' as const, factor: 'sleep_issue', values: [], minDays: 5, windowDays: 14 }] };
  const signals = {
    headacheDaysLast14d: 0,
    diaryCoverageLast28d: 0,
    avgOnsetToDoseMinutesLast28d: null,
    acuteMedDaysLast28d: 0,
    intake: null,
  };

  it('does not recommend when many logs fall on fewer than minDays days', () => {
    const ranked = rankRecommendations({
      programs: [program],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...signals, factorLogsLast14d: [0, 0, 0, 1, 1, 2, 2, 3].map(daysAgo => ({ factor: 'sleep_issue', value: '', daysAgo })) },
    });

    expect(ranked).toEqual([]);
  });

  it('reports the number of distinct days inside the window', () => {
    const ranked = rankRecommendations({
      programs: [program],
      enrolledIds: [],
      dismissedIds: [],
      signals: { ...signals, factorLogsLast14d: [0, 0, 1, 2, 3, 4, 13, 14, 15].map(daysAgo => ({ factor: 'sleep_issue', value: '', daysAgo })) },
    });

    expect(ranked).toEqual([{ id: 'sleep-regularity', reason: 'Logged sleep_issue 6 of last 14 days.' }]);
  });
});
