import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pushMock, onCloseMock } = vi.hoisted(() => ({ pushMock: vi.fn(), onCloseMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./dataHelpers', () => ({ fetchOngoingEpisode: vi.fn(async () => null) }));
vi.mock('@/features/diary/diaryApi', () => ({
  fetchTodayDiary: vi.fn(async () => ({ todayLocalDate: '2026-11-17', entry: null })),
  upsertDiaryEntry: vi.fn(),
}));
vi.mock('@/features/quickAdd/TakeMedicationSheet', () => ({ TakeMedicationSheet: () => null }));
vi.mock('./NotesModal', () => ({ NotesModal: () => null }));
vi.mock('@/features/snackbar', () => ({ showSnackbar: vi.fn() }));

const { ActionSheet } = await import('./ActionSheet');
const { ATTACK_MODE_PATH } = await import('@/features/attackMode/attackModeLogic');

beforeEach(() => {
  pushMock.mockReset();
  onCloseMock.mockReset();
});

describe('ActionSheet', () => {
  it('offers attack mode right after logging an attack', async () => {
    render(<ActionSheet open onClose={onCloseMock} />);

    const labels = (await screen.findAllByRole('button'))
      .map(b => b.textContent ?? '')
      .filter(text => text.startsWith('action_'));

    expect(labels.slice(0, 2)).toEqual([
      'action_log_attackaction_log_attack_sub',
      'action_attack_modeaction_attack_mode_sub',
    ]);
  });

  it('opens attack mode and closes the sheet', async () => {
    render(<ActionSheet open onClose={onCloseMock} />);

    const button = await screen.findByRole('button', { name: /action_attack_mode/ });
    await vi.waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(pushMock).toHaveBeenCalledWith(ATTACK_MODE_PATH);
    expect(ATTACK_MODE_PATH).toBe('/quick/attack');
    expect(onCloseMock).toHaveBeenCalled();
  });
});
