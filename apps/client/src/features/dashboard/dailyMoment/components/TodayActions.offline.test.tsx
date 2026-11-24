import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayActions } from './TodayActions';

const { startMock, refreshMock, showSnackbarMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  refreshMock: vi.fn(),
  showSnackbarMock: vi.fn(),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('@/features/quickAdd/quickAddApi', () => ({ quickAddStartEpisodeNow: startMock }));
vi.mock('@/features/quickAdd/TakeMedicationSheet', () => ({ TakeMedicationSheet: () => null }));
vi.mock('@/features/cycle/CycleToggleChip', () => ({ CycleToggleChip: () => null }));
vi.mock('@/features/episodes/attackTypePrefs', () => ({ setLastAttackType: vi.fn() }));
vi.mock('@/features/snackbar', () => ({ showSnackbar: showSnackbarMock }));

async function startMigraine() {
  render(<TodayActions hasOngoingAttack={false} ongoingAttackType={null} ongoingEpisodeId={null} onDidLog={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'start_attack' }));
  await userEvent.click(screen.getByRole('button', { name: /type_migraine/ }));
}

describe('TodayActions: start attack', () => {
  beforeEach(() => {
    startMock.mockReset();
    refreshMock.mockReset();
    showSnackbarMock.mockReset();
  });

  it('online: starts the attack and refreshes the page', async () => {
    startMock.mockResolvedValue({ queued: false, episodeId: 1 });

    await startMigraine();

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    expect(startMock).toHaveBeenCalledWith({ attackType: 'migraine' });
    expect(showSnackbarMock).not.toHaveBeenCalled();
  });

  it('offline: confirms it is saved on the device and does not refresh (which would hard-navigate)', async () => {
    startMock.mockResolvedValue({ queued: true, outboxId: 'q' });

    await startMigraine();

    await waitFor(() => expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'saved_offline' }));

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('shows server errors', async () => {
    startMock.mockRejectedValue(new Error('An attack is already in progress.'));

    await startMigraine();

    await waitFor(() => expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'An attack is already in progress.' }));
  });
});
