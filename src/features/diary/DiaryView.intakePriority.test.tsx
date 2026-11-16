import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/locales/en.json';

import { DiaryView } from './DiaryView';

// Covers the chip-ordering wiring from Task 8 for the diary's attack-factor
// surface: DiaryView fetches intake once on mount and threads the named
// trigger keys through `sortTriggersByIntake` before rendering the trigger
// chip list for a logged attack — line-for-line the same wiring as
// EpisodeForm (see EpisodeForm.intakePriority.test.tsx). Must fail open: a
// rejected /api/intake call cannot break diary rendering.
const {
  fetchIntakeMock,
  fetchTodayDiaryMock,
  fetchDiaryRangeMock,
  fetchDiaryDayDetailMock,
  fetchCycleSettingsMock,
  fetchCycleCalendarMock,
  fetchCycleContextMock,
  fetchProgramSettingsMock,
  fetchProgramDetailMock,
  getLastAttackTypeMock,
  setLastAttackTypeMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  fetchIntakeMock: vi.fn(),
  fetchTodayDiaryMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    todayLocalDate: '2025-01-01',
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
    attacks: [{
      id: 42,
      attackType: 'migraine',
      startTime: '2025-01-01T08:00:00.000Z',
      endTime: null,
      isOngoing: true,
      intensity: 3,
      triggers: [],
      protectors: [],
    }],
    medicationIntakes: [],
  })),
  fetchCycleSettingsMock: vi.fn(async () => ({ enabled: false })),
  fetchCycleCalendarMock: vi.fn(async () => ({ days: [] })),
  fetchCycleContextMock: vi.fn(async () => ({ cycleDay: null, withinPerimenstrualWindow: false })),
  fetchProgramSettingsMock: vi.fn(async () => null),
  fetchProgramDetailMock: vi.fn(async () => null),
  getLastAttackTypeMock: vi.fn(() => null),
  setLastAttackTypeMock: vi.fn(),
  searchParamsMock: new URLSearchParams('date=2025-01-01'),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./diaryApi', () => ({
  fetchTodayDiary: fetchTodayDiaryMock,
  fetchDiaryRange: fetchDiaryRangeMock,
  fetchDiaryDayDetail: fetchDiaryDayDetailMock,
  upsertDiaryEntry: vi.fn(),
}));

vi.mock('@/features/cycle/cycleApi', () => ({
  fetchCycleCalendar: fetchCycleCalendarMock,
  fetchCycleContext: fetchCycleContextMock,
  fetchCycleSettings: fetchCycleSettingsMock,
  saveBleedingDay: vi.fn(),
  updateBleedingFlow: vi.fn(),
}));

vi.mock('@/features/episodes/attackTypePrefs', () => ({
  getLastAttackType: getLastAttackTypeMock,
  setLastAttackType: setLastAttackTypeMock,
}));

vi.mock('@/features/intake/intakeApi', () => ({
  fetchIntake: fetchIntakeMock,
}));

vi.mock('@/features/programs/programsApi', () => ({
  fetchProgramSettings: fetchProgramSettingsMock,
  fetchProgramDetail: fetchProgramDetailMock,
}));

vi.mock('@/features/quickAdd/EditMedicationIntakeSheet', () => ({
  EditMedicationIntakeSheet: () => null,
}));

const DEFAULT_TRIGGER_ORDER = [
  'Poor sleep',
  'Stress',
  'Skipped meal',
  'Dehydration',
  'Caffeine',
  'Alcohol',
  'Screen time',
  'Weather',
  'Hormones',
  'Exercise',
  'Other',
];

function intakeDtoWithTriggerKeys(keys: string[]) {
  return {
    status: 'completed',
    currentStep: 4,
    version: 1,
    completedAt: new Date().toISOString(),
    answers: {
      frequency: null,
      triggers: keys.length > 0 ? { keys, custom: [] } : { keys: [], custom: [] },
      medications: null,
      habits: null,
    },
  };
}

async function renderDiary() {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DiaryView />
      </NextIntlClientProvider>,
    );
  });
}

function triggerChipLabels(): string[] {
  const title = screen.getByText('Triggers & protectors');
  const section = title.parentElement!;
  // The trigger chip row is the first `.flex.flex-wrap` sibling in this
  // section; the protector chip row is the second. "Other" is a valid label
  // for both groups, so scoping by container (not by label set) is required.
  const [triggerRow] = Array.from(section.querySelectorAll(':scope > .flex.flex-wrap'));
  return Array.from(triggerRow!.querySelectorAll('button')).map(b => b.textContent ?? '');
}

describe('DiaryView trigger chip ordering (intake priority)', () => {
  beforeEach(() => {
    fetchIntakeMock.mockReset();
    fetchTodayDiaryMock.mockClear();
    fetchDiaryRangeMock.mockClear();
    fetchDiaryDayDetailMock.mockClear();
  });

  it('moves intake-named triggers to the front, in the order the user named them', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDtoWithTriggerKeys(['weather', 'caffeine']));

    await renderDiary();

    await screen.findByText('Triggers & protectors');
    await screen.findByRole('button', { name: 'Weather' });

    expect(triggerChipLabels()).toEqual([
      'Weather',
      'Caffeine',
      'Poor sleep',
      'Stress',
      'Skipped meal',
      'Dehydration',
      'Alcohol',
      'Screen time',
      'Hormones',
      'Exercise',
      'Other',
    ]);
  });

  it('leaves chip ordering untouched when intake supplies no trigger keys', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDtoWithTriggerKeys([]));

    await renderDiary();

    await screen.findByText('Triggers & protectors');
    await screen.findByRole('button', { name: 'Poor sleep' });

    expect(triggerChipLabels()).toEqual(DEFAULT_TRIGGER_ORDER);
  });

  it('fails open: a rejected intake fetch leaves the diary rendering normally with the original chip order', async () => {
    fetchIntakeMock.mockRejectedValue(new Error('boom'));

    // Fail-open means the rejection must be handled inside the component
    // (its `.catch(() => {})`), not merely absent from the assertions below.
    // Relying on Vitest's own exit code to notice an unhandled rejection is
    // fragile — it depends on no sibling test installing a global fetch mock
    // or base URL first. Assert directly on the process-level signal instead.
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await renderDiary();

      await screen.findByText('Triggers & protectors');
      await screen.findByRole('button', { name: 'Poor sleep' });

      expect(triggerChipLabels()).toEqual(DEFAULT_TRIGGER_ORDER);

      // Give the event loop a turn so a genuinely unhandled rejection has
      // time to surface before we assert on it.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
