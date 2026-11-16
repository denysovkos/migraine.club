import { act, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/locales/en.json';

import { OutcomesView } from './OutcomesView';

// Covers the safety-critical property from Task 8: the self-reported
// frequency band (from onboarding intake) is rendered as unmistakably
// self-reported, and must never leak into the measured MMD/MHD stat tiles
// or the chart's data series. Also covers fail-open behaviour: attack
// logging / outcomes review must not break because /api/intake failed.

// Recharts' ResponsiveContainer measures a real layout box; jsdom always
// reports zero size, which makes it emit a console.warn ("width(0) and
// height(0) ... should be greater than 0") that vitest-fail-on-console
// would turn into a test failure. None of these tests assert anything about
// the rendered chart internals, so the chart library is stubbed out.
//
// The mock also captures the `data` prop ComposedChart is given: the DOM-text
// assertions above can only see what actually reaches rendered output, so
// they cannot notice a bug that merges the self-reported band into the
// chart's data series without also rendering it as text. Capturing the raw
// prop closes that hole.
let capturedChartData: unknown;
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => {
    capturedChartData = data;
    return <div>{children}</div>;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: () => null,
  Line: () => null,
}));

const { fetchIntakeMock } = vi.hoisted(() => ({
  fetchIntakeMock: vi.fn(),
}));

vi.mock('@/features/intake/intakeApi', () => ({
  fetchIntake: fetchIntakeMock,
}));

const OUTCOMES_RESPONSE = {
  windowDays: 30,
  timezone: 'UTC',
  totals: {
    mmdMin: 2,
    mmdMax: 2,
    mhdMin: 3,
    mhdMax: 3,
    acuteMedicationDays: 1,
    coverage: { totalDays: 30, recordedDays: 30, missingDays: 0 },
  },
  // Non-empty so the chart's `data` prop actually has a data point to check
  // for a leaked self-reported band — an empty array would trivially pass
  // the leak assertion below without proving anything.
  daily: [
    { date: '2025-01-05', dayType: 'migraine_day', tookMedication: true, medications: ['ibuprofen'] },
  ],
};

const SETTINGS_RESPONSE = {
  baselineStart: null,
  baselineEnd: null,
  preferredWindowDays: 30,
  timezone: 'UTC',
};

function intakeDto(frequencyBand: string | null, status: 'completed' | 'skipped' = 'completed') {
  return {
    status,
    currentStep: 4,
    version: 1,
    completedAt: status === 'completed' ? new Date().toISOString() : null,
    answers: {
      frequency: frequencyBand ? { band: frequencyBand } : null,
      triggers: null,
      medications: null,
      habits: null,
    },
  };
}

async function renderOutcomes() {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OutcomesView />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  fetchIntakeMock.mockReset();
  capturedChartData = undefined;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/outcomes/settings')) {
      return { ok: true, json: async () => SETTINGS_RESPONSE } as Response;
    }
    if (url.includes('/api/outcomes')) {
      return { ok: true, json: async () => OUTCOMES_RESPONSE } as Response;
    }
    return { ok: false, json: async () => ({ error: 'unexpected request' }) } as Response;
  }) as typeof fetch;
});

describe('OutcomesView self-reported baseline separation', () => {
  it('renders the self-reported line, framed as self-reported and not measured, when intake has a frequency band', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDto('15_plus'));

    await renderOutcomes();

    const line = await screen.findByText(/Self-reported, not measured/);

    expect(line).toHaveTextContent('Before tracking, you told us: 15 or more a month. Self-reported, not measured.');

    // The measured MMD tile must show the measured figure, untouched.
    const mmdLabel = screen.getByText('Monthly Migraine Days (MMD)');
    const mmdTile = mmdLabel.parentElement!;

    expect(within(mmdTile).getByText('2')).toBeInTheDocument();
    expect(mmdTile).not.toHaveTextContent('15 or more a month');

    const mhdLabel = screen.getByText('Monthly Headache Days (MHD)');
    const mhdTile = mhdLabel.parentElement!;

    expect(within(mhdTile).getByText('3')).toBeInTheDocument();
    expect(mhdTile).not.toHaveTextContent('15 or more a month');

    // The self-reported band phrase must appear exactly once anywhere in the
    // rendered output (the dedicated line) — never duplicated into a stat
    // tile or the chart series data.
    const bodyText = document.body.textContent ?? '';
    const occurrences = bodyText.split('15 or more a month').length - 1;

    expect(occurrences).toBe(1);

    // The DOM-text assertions above only see what actually renders — they
    // cannot notice a bug that merges the self-reported band into the
    // chart's data series without also rendering it as visible text. Assert
    // directly against the `data` prop ComposedChart received: it must
    // contain the month bucket built from measured `daily` entries, and it
    // must never contain the self-reported band this test fed in (neither
    // the raw key nor its translated phrase), in any field.
    expect(capturedChartData).toEqual([
      { month: '2025-01', monthLabel: expect.any(String), mmd: 1, mhd: 1, meds: 1 },
    ]);

    const chartDataString = JSON.stringify(capturedChartData);

    expect(chartDataString).not.toContain('15_plus');
    expect(chartDataString).not.toContain('15 or more a month');
  });

  it('does not render the self-reported line when intake was skipped', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDto(null, 'skipped'));

    await renderOutcomes();

    await screen.findByText('Monthly Migraine Days (MMD)');

    expect(screen.queryByText(/Self-reported, not measured/)).not.toBeInTheDocument();
  });

  it('does not render the self-reported line when intake has no frequency answer', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDto(null, 'completed'));

    await renderOutcomes();

    await screen.findByText('Monthly Migraine Days (MMD)');

    expect(screen.queryByText(/Self-reported, not measured/)).not.toBeInTheDocument();
  });

  it('fails open: a rejected intake fetch leaves outcomes rendering normally with no self-reported line', async () => {
    fetchIntakeMock.mockRejectedValue(new Error('boom'));

    await renderOutcomes();

    const mmdLabel = await screen.findByText('Monthly Migraine Days (MMD)');

    expect(within(mmdLabel.parentElement!).getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/Self-reported, not measured/)).not.toBeInTheDocument();
  });
});
