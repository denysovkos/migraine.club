import type { Episode } from '@/types/Episode';
import messages from '@migraine/locales/en.json';
import { render, screen } from '@testing-library/react';

import { NextIntlClientProvider } from 'next-intl';
import { vi } from 'vitest';

import { EpisodeForm } from './EpisodeForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

describe('EpisodeForm (medication intakes)', () => {
  it('renders Medication intakes section and does not render legacy medications description', () => {
    const episode: Episode = {
      id: 1,
      userId: 'user_1',
      startTime: new Date(),
      endTime: null,
      isOngoing: true,
      intensity: 5,
      painLocation: 'OTHER' as any,
      painLocationOther: null,
      painType: 'OTHER' as any,
      painTypeOther: null,
      symptoms: [],
      symptomsOther: null,
      medicationIntakes: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          takenAt: new Date().toISOString(),
          label: 'Sumatriptan',
          dose: '50',
          unit: 'mg',
          unitIsCustom: false,
        },
      ],
      triggers: [],
      protectors: [],
      triggersOther: null,
      notes: null,
      weatherPainIndexId: null,
      weatherContext: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EpisodeForm episode={episode} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Medication intakes')).toBeInTheDocument();
    expect(screen.getByText('Sumatriptan')).toBeInTheDocument();
    expect(screen.queryByText(/legacy field/i)).not.toBeInTheDocument();

    // Acute medications section removed from UI
    expect(screen.queryByText('Medication taken')).not.toBeInTheDocument();
    expect(screen.queryByText(/Log acute medications taken during this episode/i)).not.toBeInTheDocument();

    // Controls exist
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
