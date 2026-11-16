'use client';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsView } from './InsightsView';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/features/snackbar', () => ({
  showSnackbar: vi.fn(),
}));

vi.mock('@/utils/analytics', () => ({
  trackEvent: vi.fn(),
}));

const basePayload = {
  status: 'ready',
  computedAt: new Date().toISOString(),
  dataReadiness: {
    diaryDaysRecorded: 50,
    diaryDaysTotal: 90,
    diaryCoveragePct: 0.55,
    attackStarts: 8,
    lastComputedAt: new Date().toISOString(),
    missing: [],
  },
  highlights: [],
  buckets: [
    { id: 'likely_increases', title: 'Likely increases risk', items: [] },
    { id: 'likely_decreases', title: 'Likely decreases risk', items: [] },
    { id: 'no_clear_association', title: 'No clear association', items: [] },
  ],
  trends: { weeklyAttackStarts: [] },
  inputStats: {
    windowDays: 90,
    caseMomentsUsed: 8,
    diaryDaysObserved: 50,
    factorsTested: 10,
    exclusions: { episodesOutsideWindow: 0, factorEventsDuringAttack: 0, candidateControlsRejected: 0 },
  },
};

describe('InsightsView', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/insights/test-plans')) {
        return Promise.resolve(
          new Response(JSON.stringify({ plans: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ) as any;
      }
      if (url.includes('/api/cycle/insights')) {
        return Promise.resolve(
          new Response(JSON.stringify({
            enabled: false,
            hasEnoughData: false,
            totalAttacks: 0,
            attacksInWindow: 0,
            attacksOutOfWindow: 0,
            inWindowPct: null,
            rangeStart: -2,
            rangeEnd: 3,
            histogram: [],
            bleedingStartCount: 0,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ) as any;
      }
      if (url.includes('/api/insights')) {
        return Promise.resolve(
          new Response(JSON.stringify({ state: 'ready', payload: basePayload }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ) as any;
      }
      return Promise.reject(new Error('Unexpected fetch'));
    }) as any;
  });

  it('shows insufficient data state', async () => {
    (globalThis.fetch as any).mockImplementationOnce((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/insights/test-plans')) {
        return Promise.resolve(new Response(JSON.stringify({ plans: [] }), { status: 200 }));
      }
      if (url.includes('/api/cycle/insights')) {
        return Promise.resolve(new Response(JSON.stringify({
          enabled: false,
          hasEnoughData: false,
          totalAttacks: 0,
          attacksInWindow: 0,
          attacksOutOfWindow: 0,
          inWindowPct: null,
          rangeStart: -2,
          rangeEnd: 3,
          histogram: [],
          bleedingStartCount: 0,
        }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            state: 'ready',
            payload: { ...basePayload, status: 'insufficient_data' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    render(<InsightsView />);

    expect(await screen.findByText('insufficient_title')).toBeInTheDocument();
  });

  it('shows no strong signals state', async () => {
    (globalThis.fetch as any).mockImplementationOnce((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/insights/test-plans')) {
        return Promise.resolve(new Response(JSON.stringify({ plans: [] }), { status: 200 }));
      }
      if (url.includes('/api/cycle/insights')) {
        return Promise.resolve(new Response(JSON.stringify({
          enabled: false,
          hasEnoughData: false,
          totalAttacks: 0,
          attacksInWindow: 0,
          attacksOutOfWindow: 0,
          inWindowPct: null,
          rangeStart: -2,
          rangeEnd: 3,
          histogram: [],
          bleedingStartCount: 0,
        }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            state: 'ready',
            payload: { ...basePayload, status: 'no_strong_signals' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    render(<InsightsView />);

    expect(await screen.findByText('no_strong_signals')).toBeInTheDocument();
  });

  it('renders a signal card when present', async () => {
    const payload = {
      ...basePayload,
      highlights: [{
        id: 'f:0_12h',
        factorId: 'f',
        factorName: 'Stress',
        factorType: 'trigger',
        window: '0_12h',
        bucket: 'likely_increases',
        direction: 'increase',
        caseRate: 0.5,
        controlRate: 0.2,
        riskDiff: 0.3,
        riskDiffCi: { low: 0.1, high: 0.5 },
        pValue: 0.01,
        qValue: 0.02,
        confidence: 'high',
        possibleEarlySign: false,
        counts: {
          setsUsed: 8,
          controlsPerSetAvg: 3,
          caseExposed: 4,
          caseTotal: 8,
          controlExposed: 2,
          controlTotal: 8,
        },
      }],
    };
    (globalThis.fetch as any).mockImplementationOnce((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/insights/test-plans')) {
        return Promise.resolve(new Response(JSON.stringify({ plans: [] }), { status: 200 }));
      }
      if (url.includes('/api/cycle/insights')) {
        return Promise.resolve(new Response(JSON.stringify({
          enabled: false,
          hasEnoughData: false,
          totalAttacks: 0,
          attacksInWindow: 0,
          attacksOutOfWindow: 0,
          inWindowPct: null,
          rangeStart: -2,
          rangeEnd: 3,
          histogram: [],
          bleedingStartCount: 0,
        }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ state: 'ready', payload }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });

    render(<InsightsView />);

    expect(await screen.findByText('Stress')).toBeInTheDocument();
    expect(await screen.findByText('run_test')).toBeInTheDocument();
  });
});
