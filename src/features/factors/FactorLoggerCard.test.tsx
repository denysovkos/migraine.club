import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';

const {
  fetchTodayDiaryMock,
  fetchDiaryRangeMock,
  fetchDiaryDayDetailMock,
  fetchCycleSettingsMock,
  fetchCycleCalendarMock,
  fetchCycleContextMock,
  searchParamsMock,
  translateMock,
  fetchFactorOptionsMock,
  logFactorMock,
  showSnackbarMock,
} = vi.hoisted(() => ({
  fetchTodayDiaryMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    todayLocalDate: '2025-01-02',
    entry: null,
  })),
  fetchDiaryRangeMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    entries: [],
    attackDays: [],
    medicationDays: [],
    coverage: { totalDays: 31, recordedDays: 0, missingDays: 31 },
  })),
  fetchDiaryDayDetailMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    entry: null,
    attacks: [],
    medicationIntakes: [],
  })),
  fetchCycleSettingsMock: vi.fn(async () => ({ enabled: false })),
  fetchCycleCalendarMock: vi.fn(async () => ({ days: [] })),
  fetchCycleContextMock: vi.fn(async () => ({ cycleDay: null, withinPerimenstrualWindow: false })),
  searchParamsMock: new URLSearchParams('date=2025-01-01'),
  translateMock: vi.fn((key: string) => key),
  fetchFactorOptionsMock: vi.fn(async () => ({
    trigger: {
      builtIns: [{ key: 'stress', translationKey: 'builtins.trigger.stress', logged: false }],
      recent: [],
    },
    protector: {
      builtIns: [{ key: 'hydration', translationKey: 'builtins.protector.hydration', logged: false }],
      recent: [],
    },
  })),
  logFactorMock: vi.fn(async () => ({})),
  showSnackbarMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translateMock,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/features/snackbar', () => ({
  showSnackbar: showSnackbarMock,
}));

vi.mock('@/features/diary/diaryApi', () => ({
  fetchTodayDiary: fetchTodayDiaryMock,
  fetchDiaryRange: fetchDiaryRangeMock,
  fetchDiaryDayDetail: fetchDiaryDayDetailMock,
  upsertDiaryEntry: vi.fn(async () => ({
    id: 'entry-1',
    userId: 'user-1',
    localDate: '2025-01-01',
    timezone: 'Europe/Berlin',
    dayType: 'headache_free',
    createdFrom: 'user',
    impact: null,
    notes: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  })),
}));

vi.mock('@/features/cycle/cycleApi', () => ({
  fetchCycleCalendar: fetchCycleCalendarMock,
  fetchCycleContext: fetchCycleContextMock,
  fetchCycleSettings: fetchCycleSettingsMock,
  saveBleedingDay: vi.fn(),
  updateBleedingFlow: vi.fn(),
}));

vi.mock('@/features/episodes/attackTypePrefs', () => ({
  getLastAttackType: vi.fn(() => 'migraine'),
  setLastAttackType: vi.fn(),
}));

vi.mock('./factorsApi', () => ({
  fetchFactorOptions: fetchFactorOptionsMock,
  logFactorEvent: logFactorMock,
}));

vi.mock('../dashboard/dailyMoment/components/TodayMomentCard', () => ({
  TodayMomentCard: () => null,
}));

vi.mock('../dashboard/dailyMoment/components/AttackInProgressCard', () => ({
  AttackInProgressCard: () => null,
}));

vi.mock('../dashboard/dailyMoment/components/TodayActions', () => ({
  TodayActions: () => null,
}));

vi.mock('../dashboard/dailyMoment/components/PreventivesDueStrip', () => ({
  PreventivesDueStrip: () => null,
}));

vi.mock('../dashboard/dailyMoment/components/PinnedMedsQuickKit', () => ({
  PinnedMedsQuickKit: () => null,
}));

vi.mock('../dashboard/dailyMoment/components/MohGuardrailBanner', () => ({
  MohGuardrailBanner: () => null,
}));

describe('FactorLoggerCard', () => {
  beforeEach(() => {
    fetchTodayDiaryMock.mockClear();
    fetchDiaryRangeMock.mockClear();
    fetchDiaryDayDetailMock.mockReset();
    fetchDiaryDayDetailMock.mockImplementation(async () => ({
      timezone: 'Europe/Berlin',
      entry: null,
      attacks: [],
      medicationIntakes: [],
    }));
    fetchCycleSettingsMock.mockClear();
    fetchCycleCalendarMock.mockClear();
    fetchCycleContextMock.mockClear();
    fetchFactorOptionsMock.mockClear();
    logFactorMock.mockClear();
    showSnackbarMock.mockClear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/insights/test-plans')) {
        return {
          ok: true,
          json: async () => ({ plans: [] }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({}),
      } as Response;
    }) as any;
  });

  it('logs a built-in trigger for the provided local date', async () => {
    const user = userEvent.setup();
    const { FactorLoggerCard } = await import('./FactorLoggerCard');

    render(<FactorLoggerCard localDate="2025-01-01" />);

    await user.click(await screen.findByRole('button', { name: /builtins.trigger.stress/i }));

    expect(logFactorMock).toHaveBeenCalledWith({
      displayName: 'stress',
      type: 'trigger',
      localDate: '2025-01-01',
    });
  });

  it('calls onDidLog after a successful log', async () => {
    const user = userEvent.setup();
    const onDidLog = vi.fn();
    const { FactorLoggerCard } = await import('./FactorLoggerCard');

    render(<FactorLoggerCard localDate="2025-01-01" onDidLog={onDidLog} />);

    await user.click(await screen.findByRole('button', { name: /builtins.trigger.stress/i }));

    await waitFor(() => {
      expect(onDidLog).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onDidLog when save fails', async () => {
    logFactorMock.mockRejectedValueOnce(new Error('save failed'));
    const user = userEvent.setup();
    const onDidLog = vi.fn();
    const { FactorLoggerCard } = await import('./FactorLoggerCard');

    render(<FactorLoggerCard localDate="2025-01-01" onDidLog={onDidLog} />);

    await user.click(await screen.findByRole('button', { name: /builtins.trigger.stress/i }));

    await waitFor(() => {
      expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'save failed' });
    });

    expect(onDidLog).not.toHaveBeenCalled();
  });

  it('prevents repeated submissions while save is in flight', async () => {
    let resolveLog: (() => void) | undefined;
    logFactorMock.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          resolveLog = () => resolve({});
        }),
    );
    const user = userEvent.setup();
    const { FactorLoggerCard } = await import('./FactorLoggerCard');

    render(<FactorLoggerCard localDate="2025-01-01" />);

    const button = await screen.findByRole('button', { name: /builtins.trigger.stress/i });
    await user.click(button);
    await user.click(button);

    expect(logFactorMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    resolveLog?.();

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });

  it('clears stale factor buttons while reloading a new local date', async () => {
    let rejectReload: ((reason?: unknown) => void) | undefined;
    fetchFactorOptionsMock
      .mockResolvedValueOnce({
        trigger: {
          builtIns: [{ key: 'stress', translationKey: 'builtins.trigger.stress', logged: false }],
          recent: [],
        },
        protector: {
          builtIns: [{ key: 'hydration', translationKey: 'builtins.protector.hydration', logged: false }],
          recent: [],
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReload = reject;
          }),
      );
    const { FactorLoggerCard } = await import('./FactorLoggerCard');

    const { rerender } = render(<FactorLoggerCard localDate="2025-01-01" />);

    expect(await screen.findByRole('button', { name: /builtins.trigger.stress/i })).toBeInTheDocument();

    rerender(<FactorLoggerCard localDate="2025-01-02" />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /builtins.trigger.stress/i })).not.toBeInTheDocument();
    });

    rejectReload?.(new Error('reload failed'));

    expect(await screen.findByText('reload failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /builtins.trigger.stress/i })).not.toBeInTheDocument();
  });

  it('does not render factor tracking in the daily moment stack', async () => {
    const { DailyMomentStack } = await import('../dashboard/dailyMoment/DailyMomentStack');

    render(<DailyMomentStack />);

    await waitFor(() => {
      expect(screen.queryByText('card_title')).not.toBeInTheDocument();
    });
  });

  it('renders synced attack factors for diary attacks', async () => {
    fetchDiaryDayDetailMock.mockResolvedValueOnce({
      timezone: 'Europe/Berlin',
      entry: null,
      attacks: [{
        id: 42,
        attackType: 'migraine',
        startTime: '2025-01-01T08:00:00.000Z',
        endTime: null,
        isOngoing: true,
        intensity: 3,
        triggers: ['STRESS'],
        protectors: ['HYDRATION'],
      }],
      medicationIntakes: [],
    } as any);

    const { DiaryView } = await import('@/features/diary/DiaryView');

    render(<DiaryView />);

    expect(await screen.findByText('attack_factors_title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builtins.trigger.stress' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'builtins.protector.hydration' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides the start-attack toggle while loading an already-marked attack day', async () => {
    fetchDiaryRangeMock.mockResolvedValueOnce({
      timezone: 'Europe/Berlin',
      entries: [],
      attackDays: ['2025-01-01'] as any,
      medicationDays: [],
      coverage: { totalDays: 31, recordedDays: 0, missingDays: 31 },
    });
    fetchDiaryDayDetailMock.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep loading pending to verify the intermediate UI state.
        }),
    );

    const { DiaryView } = await import('@/features/diary/DiaryView');

    render(<DiaryView />);

    await waitFor(() => {
      expect(screen.queryByText('will_start_attack_migraine')).not.toBeInTheDocument();
    });
  });

  it('loads day detail only once for an already-marked attack day', async () => {
    fetchDiaryRangeMock.mockResolvedValueOnce({
      timezone: 'Europe/Berlin',
      entries: [],
      attackDays: ['2025-01-01'] as any,
      medicationDays: [],
      coverage: { totalDays: 31, recordedDays: 0, missingDays: 31 },
    });
    fetchDiaryDayDetailMock
      .mockResolvedValueOnce({
        timezone: 'Europe/Berlin',
        entry: null,
        attacks: [{
          id: 42,
          attackType: 'migraine',
          startTime: '2025-01-01T08:00:00.000Z',
          endTime: null,
          isOngoing: true,
          intensity: 3,
          triggers: ['STRESS'],
          protectors: ['HYDRATION'],
        }],
        medicationIntakes: [],
      } as any);

    const { DiaryView } = await import('@/features/diary/DiaryView');

    render(<DiaryView />);

    expect(await screen.findByText('attack_factors_title')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchDiaryDayDetailMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('will_start_attack_migraine')).not.toBeInTheDocument();
    expect(screen.getByText('ongoing_attack_migraine')).toBeInTheDocument();
  });

  it('renders the loaded attack in React strict mode', async () => {
    fetchDiaryRangeMock.mockResolvedValueOnce({
      timezone: 'Europe/Berlin',
      entries: [],
      attackDays: ['2025-01-01'] as any,
      medicationDays: [],
      coverage: { totalDays: 31, recordedDays: 0, missingDays: 31 },
    });
    fetchDiaryDayDetailMock.mockResolvedValueOnce({
      timezone: 'Europe/Berlin',
      entry: null,
      attacks: [{
        id: 107,
        attackType: 'migraine',
        startTime: '2026-04-04T20:55:12.778Z',
        endTime: null,
        isOngoing: true,
        intensity: 3,
        triggers: ['STRESS'],
        protectors: ['REGULAR_MEALS'],
      }],
      medicationIntakes: [],
    } as any);

    const { DiaryView } = await import('@/features/diary/DiaryView');

    render(
      <StrictMode>
        <DiaryView />
      </StrictMode>,
    );

    expect(await screen.findByText('ongoing_attack_migraine')).toBeInTheDocument();
    expect(screen.getByText('attack_factors_title')).toBeInTheDocument();
  });
});

describe('logFactorEvent', () => {
  it('throws when localDate is invalid', async () => {
    const { logFactorEvent } = await vi.importActual<typeof import('./factorsApi')>('./factorsApi');

    await expect(
      logFactorEvent({
        displayName: 'stress',
        type: 'trigger',
        localDate: '2025-13-40',
      }),
    ).rejects.toThrow('Invalid localDate');
  });
});
