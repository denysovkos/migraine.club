import messages from '@migraine/locales/en.json';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EpisodeForm } from './EpisodeForm';

// Covers the chip-ordering wiring from Task 8: EpisodeForm fetches intake once
// on mount and threads the named trigger keys through `sortTriggersByIntake`
// before rendering the trigger chip list. This must never break attack
// logging itself — a rejected /api/intake call (fail-open) has to leave the
// form usable with the untouched default ordering.
const { pushMock, refreshMock, logFactorEventMock, fetchIntakeMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  logFactorEventMock: vi.fn(async () => ({})),
  fetchIntakeMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    back: vi.fn(),
  }),
}));

vi.mock('@/features/factors/factorsApi', () => ({
  logFactorEvent: logFactorEventMock,
}));

vi.mock('@/features/intake/intakeApi', () => ({
  fetchIntake: fetchIntakeMock,
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

async function renderForm() {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeForm />
      </NextIntlClientProvider>,
    );
  });
}

function triggerChipLabels(): string[] {
  const triggersLabel = screen.getByText('Triggers');
  const container = triggersLabel.parentElement!;
  return Array.from(container.querySelectorAll('button')).map(b => b.textContent ?? '');
}

describe('EpisodeForm trigger chip ordering (intake priority)', () => {
  beforeEach(() => {
    fetchIntakeMock.mockReset();
  });

  it('moves intake-named triggers to the front, in the order the user named them', async () => {
    fetchIntakeMock.mockResolvedValue(intakeDtoWithTriggerKeys(['weather', 'caffeine']));

    await renderForm();

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

    await renderForm();

    await screen.findByRole('button', { name: 'Poor sleep' });

    expect(triggerChipLabels()).toEqual(DEFAULT_TRIGGER_ORDER);
  });

  it('fails open: a rejected intake fetch leaves the form rendering normally with the original chip order', async () => {
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
      await renderForm();

      await screen.findByRole('button', { name: 'Poor sleep' });

      expect(triggerChipLabels()).toEqual(DEFAULT_TRIGGER_ORDER);
      // Attack logging itself must still work — chips are clickable, form intact.
      expect(screen.getByRole('button', { name: 'Save Attack' })).toBeEnabled();

      // Give the event loop a turn so a genuinely unhandled rejection has
      // time to surface before we assert on it.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
