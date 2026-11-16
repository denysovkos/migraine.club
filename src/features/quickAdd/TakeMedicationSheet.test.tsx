import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';

const { quickAddCreateIntakeMock } = vi.hoisted(() => ({
  quickAddCreateIntakeMock: vi.fn(async () => ({
    intakeId: '00000000-0000-0000-0000-000000000010',
    userMedicationId: '00000000-0000-0000-0000-000000000001',
  })),
}));

vi.mock('@/features/quickAdd/quickAddApi', () => {
  return {
    fetchQuickAddSuggestions: vi.fn(async () => ({
      topMeds: [],
      hasOngoingEpisode: true,
    })),
    fetchMedicationPickerIndex: vi.fn(async () => ({
      pinned: [],
      recentlyUsed: [],
      all: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          label: 'Sumatriptan',
          defaultDose: '50',
          defaultUnit: 'mg',
          defaultUnitIsCustom: false,
          lastUsedDose: '50',
          lastUsedUnit: 'mg',
          lastUsedUnitIsCustom: false,
          lastUsedAt: '2025-01-01T00:00:00.000Z',
          isPinned: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          label: 'Ibuprofen',
          defaultDose: null,
          defaultUnit: 'mg',
          defaultUnitIsCustom: false,
          lastUsedDose: null,
          lastUsedUnit: null,
          lastUsedUnitIsCustom: false,
          lastUsedAt: null,
          isPinned: false,
        },
      ],
    })),
    searchMedications: vi.fn(async () => ({ results: [] })),
    quickAddCreateIntake: quickAddCreateIntakeMock,
    quickAddUndoIntake: vi.fn(async () => {}),
  };
});

vi.mock('@/features/quickAdd/acuteMedsApi', () => ({
  createAcuteDose: vi.fn(async () => ({ doseId: 'dose', attackId: null })),
}));

vi.mock('@/features/snackbar', () => ({ showSnackbar: vi.fn() }));

describe('TakeMedicationSheet', () => {
  it('shows collapsed action dock by default and logs immediately when dose is known', async () => {
    render(<TakeMedicationSheet open onOpenChange={() => {}} />);

    expect(await screen.findByText('Select a medication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log now' })).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: 'Sumatriptan' }));

    expect(quickAddCreateIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMedicationId: '00000000-0000-0000-0000-000000000001',
        dose: '50',
      }),
      expect.any(Object),
    );
  });

  it('selects medication and keeps dock visible when dose is unknown', async () => {
    render(<TakeMedicationSheet open onOpenChange={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Ibuprofen' }));

    expect(await screen.findByText('Change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip dose' })).toBeEnabled();
  });
});
