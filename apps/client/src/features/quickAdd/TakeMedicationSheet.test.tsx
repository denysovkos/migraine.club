import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';

import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';

const { showSnackbarMock, removeOutboxItemMock, quickAddUndoIntakeMock } = vi.hoisted(() => ({
  showSnackbarMock: vi.fn(),
  removeOutboxItemMock: vi.fn(async () => {}),
  quickAddUndoIntakeMock: vi.fn(async () => {}),
}));

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
    quickAddUndoIntake: quickAddUndoIntakeMock,
  };
});

vi.mock('@/features/quickAdd/acuteMedsApi', () => ({
  createAcuteDose: vi.fn(async () => ({ doseId: 'dose', attackId: null })),
}));

vi.mock('@/features/snackbar', () => ({ showSnackbar: showSnackbarMock }));

vi.mock('@/libs/offline/outbox', () => ({ removeOutboxItem: removeOutboxItemMock }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

type SnackbarCall = { message: string; actions?: Array<{ label: string; onClick: () => Promise<void> }> };

function lastSnackbar(): SnackbarCall {
  return showSnackbarMock.mock.calls.at(-1)![0] as SnackbarCall;
}

describe('TakeMedicationSheet', () => {
  beforeEach(() => {
    showSnackbarMock.mockClear();
    removeOutboxItemMock.mockClear();
    quickAddUndoIntakeMock.mockClear();
    quickAddCreateIntakeMock.mockClear();
  });

  it('shows collapsed action dock by default and logs immediately when dose is known', async () => {
    render(<TakeMedicationSheet open onOpenChange={() => {}} />);

    expect(await screen.findByText('Select a medication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log now' })).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: 'Sumatriptan' }));

    expect(quickAddCreateIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMedicationId: '00000000-0000-0000-0000-000000000001',
        dose: '50',
        // One unit for the offline queue: device time + acute dose in the same request.
        takenAt: expect.any(String),
        recordAcuteDose: true,
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

  it('online: logs, then Undo deletes the saved intake', async () => {
    quickAddCreateIntakeMock.mockResolvedValueOnce({
      queued: false,
      intakeId: '00000000-0000-0000-0000-000000000010',
      userMedicationId: '00000000-0000-0000-0000-000000000001',
    } as any);
    const onDidLog = vi.fn();
    render(<TakeMedicationSheet open onOpenChange={() => {}} onDidLog={onDidLog} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sumatriptan' }));
    await waitFor(() => expect(onDidLog).toHaveBeenCalled());

    const snackbar = lastSnackbar();

    expect(snackbar.message).toBe('Sumatriptan logged');

    await act(() => snackbar.actions!.find(a => a.label === 'Undo')!.onClick());

    expect(quickAddUndoIntakeMock).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010');
    expect(removeOutboxItemMock).not.toHaveBeenCalled();
  });

  it('offline: tells the user it is saved on the device, and Undo removes it from the queue', async () => {
    quickAddCreateIntakeMock.mockResolvedValueOnce({ queued: true, outboxId: 'q-1' } as any);
    render(<TakeMedicationSheet open onOpenChange={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sumatriptan' }));

    await waitFor(() => expect(lastSnackbar().message).toBe('Sumatriptan: saved_offline'));

    await act(() => lastSnackbar().actions![0]!.onClick());

    expect(removeOutboxItemMock).toHaveBeenCalledWith('q-1');
    expect(quickAddUndoIntakeMock).not.toHaveBeenCalled();
  });

  it('offline: Undo pressed before the entry was stored still removes it', async () => {
    let resolveCreate!: (v: unknown) => void;
    quickAddCreateIntakeMock.mockReturnValueOnce(new Promise((r) => {
      resolveCreate = r;
    }) as any);
    render(<TakeMedicationSheet open onOpenChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sumatriptan' }));

    await act(async () => {
      const undo = lastSnackbar().actions!.find(a => a.label === 'Undo')!.onClick();
      resolveCreate({ queued: true, outboxId: 'q-2' });
      await undo;
    });

    expect(removeOutboxItemMock).toHaveBeenCalledWith('q-2');
    expect(removeOutboxItemMock).toHaveBeenCalledTimes(1);
    // No "saved on this device" message for an entry the user just undid.
    expect(showSnackbarMock.mock.calls.map(c => (c[0] as SnackbarCall).message)).not.toContain('Sumatriptan: saved_offline');
  });
});
