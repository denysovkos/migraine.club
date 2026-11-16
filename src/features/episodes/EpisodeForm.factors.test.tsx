import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi } from 'vitest';

import messages from '@/locales/en.json';

import { EpisodeForm } from './EpisodeForm';

const { pushMock, refreshMock, logFactorEventMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  logFactorEventMock: vi.fn(async () => ({})),
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

describe('EpisodeForm factors', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    logFactorEventMock.mockClear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/episodes')) {
        return {
          ok: true,
          json: async () => ({
            id: 1,
          }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ error: 'unexpected request' }),
      } as Response;
    }) as typeof fetch;
  });

  it('keeps multiple trigger and protector chips selected until submit, then logs them together', async () => {
    const user = userEvent.setup();

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeForm />
      </NextIntlClientProvider>,
    );

    const poorSleepButton = screen.getByRole('button', { name: 'Poor sleep' });
    const stressButton = screen.getByRole('button', { name: 'Stress' });
    const hydrationButton = screen.getByRole('button', { name: 'Hydration' });

    await user.click(poorSleepButton);
    await user.click(stressButton);
    await user.click(hydrationButton);

    expect(poorSleepButton).toHaveAttribute('aria-pressed', 'true');
    expect(stressButton).toHaveAttribute('aria-pressed', 'true');
    expect(hydrationButton).toHaveAttribute('aria-pressed', 'true');
    expect(poorSleepButton).toBeEnabled();
    expect(stressButton).toBeEnabled();
    expect(hydrationButton).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save Attack' }));

    await waitFor(() => {
      expect(logFactorEventMock).toHaveBeenCalledTimes(3);
    });

    expect(logFactorEventMock).toHaveBeenNthCalledWith(1, {
      displayName: 'sleep_issue',
      type: 'trigger',
      localDate: expect.any(String),
    });
    expect(logFactorEventMock).toHaveBeenNthCalledWith(2, {
      displayName: 'stress',
      type: 'trigger',
      localDate: expect.any(String),
    });
    expect(logFactorEventMock).toHaveBeenNthCalledWith(3, {
      displayName: 'hydration',
      type: 'protector',
      localDate: expect.any(String),
    });

    expect(pushMock).toHaveBeenCalledWith('/dashboard');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('loads previously saved protectors when editing an episode', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeForm
          episode={{
            id: 1,
            userId: 'user-1',
            attackType: 'migraine',
            startTime: new Date('2025-01-01T08:00:00.000Z'),
            endTime: null,
            isOngoing: true,
            intensity: 3,
            painLocation: 'WHOLE_HEAD',
            painLocationOther: null,
            painType: 'THROBBING',
            painTypeOther: null,
            symptoms: [],
            symptomsOther: null,
            medicationIntakes: [],
            triggers: ['STRESS'],
            protectors: ['HYDRATION', 'REST'],
            triggersOther: null,
            notes: null,
            weatherPainIndexId: null,
            weatherContext: null,
            createdAt: new Date('2025-01-01T08:00:00.000Z'),
            updatedAt: new Date('2025-01-01T08:00:00.000Z'),
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Hydration' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stress' })).toHaveAttribute('aria-pressed', 'true');
  });
});
