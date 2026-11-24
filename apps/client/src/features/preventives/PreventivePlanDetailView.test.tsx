import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const { fetchPreventiveSummaryMock, tMock } = vi.hoisted(() => ({
  fetchPreventiveSummaryMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    plan: {
      id: 'plan-1',
      name: 'Topiramate',
      kind: 'oral',
      doseText: null,
      scheduleLabel: 'Daily',
      scheduleType: 'daily',
      schedulePayload: null,
      startDate: '2025-01-01',
      status: 'active',
    },
    baseline: {
      from: '2024-12-04',
      to: '2024-12-31',
      mmd: 6,
      mhd: 10,
      acuteMedicationDays: 4,
      coverage: { totalDays: 28, recordedDays: 28, missingDays: 0 },
    },
    evaluation: {
      from: '2025-01-15',
      to: '2025-02-11',
      mmd: 3,
      mhd: 6,
      acuteMedicationDays: 2,
      coverage: { totalDays: 28, recordedDays: 10, missingDays: 18 },
      percentChangeMmd: null,
      responder50: 'NOT_ENOUGH_DATA',
      missingDaysNeeded: 18,
    },
    evaluationLong: null,
    adherence: {
      last7: { dueDays: 7, taken: 3, missed: 1, unsure: 3, coverage: 1 },
      last28: { dueDays: 28, taken: 10, missed: 2, unsure: 16, coverage: 1 },
    },
    timelineWeeks: [],
  })),
  tMock: (key: string, vars?: Record<string, any>) => {
    if (!vars) {
      return key;
    }
    return Object.keys(vars).reduce((acc, k) => acc.replace(`{${k}}`, String(vars[k])), key);
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => tMock,
}));

vi.mock('@/features/preventives/preventivesApi', () => ({
  fetchPreventiveSummary: fetchPreventiveSummaryMock,
  pausePreventivePlan: vi.fn(async () => {}),
  resumePreventivePlan: vi.fn(async () => {}),
  stopPreventivePlan: vi.fn(async () => {}),
  updatePreventivePlan: vi.fn(async () => {}),
}));

vi.mock('@/features/snackbar', () => ({ showSnackbar: vi.fn() }));
vi.mock('@/utils/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('PreventivePlanDetailView', () => {
  it('shows not enough data message', async () => {
    const { PreventivePlanDetailView } = await import('./PreventivePlanDetailView');
    render(<PreventivePlanDetailView planId="plan-1" />);

    await screen.findByText('Topiramate');

    expect(screen.getByText(/not_enough_data/i)).toBeInTheDocument();
  });
});
