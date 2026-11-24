import type { Episode } from '@/types/Episode';
import messages from '@migraine/locales/en.json';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { EpisodeFactorSummary } from './EpisodeFactorSummary';

const baseEpisode: Episode = {
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
  triggers: [],
  protectors: [],
  triggersOther: null,
  notes: null,
  weatherPainIndexId: null,
  weatherContext: null,
  createdAt: new Date('2025-01-01T08:00:00.000Z'),
  updatedAt: new Date('2025-01-01T08:00:00.000Z'),
};

describe('EpisodeFactorSummary', () => {
  it('renders saved triggers and protectors together', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeFactorSummary
          episode={{
            ...baseEpisode,
            triggers: ['SLEEP_ISSUE', 'STRESS'],
            protectors: ['HYDRATION'],
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Poor sleep')).toBeInTheDocument();
    expect(screen.getByText('Stress')).toBeInTheDocument();
    expect(screen.getByText('Hydration')).toBeInTheDocument();
  });

  it('shows the remaining factor count when there are more than three', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeFactorSummary
          episode={{
            ...baseEpisode,
            triggers: ['SLEEP_ISSUE', 'STRESS', 'WEATHER'],
            protectors: ['HYDRATION', 'REST'],
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows a fallback when no factors were saved', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeFactorSummary episode={baseEpisode} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('No triggers or protectors')).toBeInTheDocument();
  });
});
