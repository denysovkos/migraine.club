import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAttackModeState: vi.fn(),
  endAttackNow: vi.fn(),
  setAttackPain: vi.fn(),
  quickAddStartEpisodeNow: vi.fn(),
  quickAddCreateIntake: vi.fn(),
  quickAddUndoIntake: vi.fn(async () => {}),
  deleteEpisode: vi.fn(async () => {}),
  removeOutboxItem: vi.fn(async () => {}),
  recordReliefSession: vi.fn(),
}));

vi.mock('./attackModeApi', () => ({
  fetchAttackModeState: mocks.fetchAttackModeState,
  endAttackNow: mocks.endAttackNow,
  setAttackPain: mocks.setAttackPain,
}));
vi.mock('@/features/quickAdd/quickAddApi', () => ({
  quickAddStartEpisodeNow: mocks.quickAddStartEpisodeNow,
  quickAddCreateIntake: mocks.quickAddCreateIntake,
  quickAddUndoIntake: mocks.quickAddUndoIntake,
  deleteEpisode: mocks.deleteEpisode,
}));
vi.mock('@/libs/offline/outbox', () => ({ removeOutboxItem: mocks.removeOutboxItem }));
vi.mock('./relief/reliefApi', () => ({ recordReliefSession: mocks.recordReliefSession }));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));

const { AttackMode } = await import('./AttackMode');

const SUMA = {
  userMedicationId: '00000000-0000-0000-0000-000000000001',
  label: 'Sumatriptan',
  suggestedDose: '50',
  suggestedUnit: 'mg',
  unitIsCustom: false,
};

function ready(over: Partial<{ ongoing: any; meds: any[] }> = {}) {
  mocks.fetchAttackModeState.mockResolvedValue({ status: 'ready', ongoing: null, meds: [SUMA], ...over });
}

const ONGOING = { id: 7, startTime: '2026-11-17T08:00:00.000Z', intensity: 3 };

beforeEach(() => {
  for (const m of Object.values(mocks)) {
    m.mockReset();
  }
});

describe('AttackMode', () => {
  it('offers the four actions with large tap targets and no ongoing attack', async () => {
    ready();
    render(<AttackMode />);

    const start = await screen.findByRole('button', { name: /start_attack/ });

    expect(screen.getByRole('button', { name: /took_medication/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /pain_level/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /pain_level/ })).toHaveTextContent('pain_level_needs_attack');
    expect(screen.getByRole('link', { name: 'exit' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByTestId('attack-mode')).toHaveClass('bg-black');
    expect(screen.getByRole('button', { name: /relax/ })).toBeEnabled();
    expect(start.parentElement).toHaveClass('grid-rows-4');
  });

  it('opens relief exercises from home, also without an attack, and comes back', async () => {
    ready();
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /relax/ }));

    expect(screen.getByTestId('relief-menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exercise_breathing/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(await screen.findByRole('button', { name: /start_attack/ })).toBeInTheDocument();
  });

  it('records a relief session against the ongoing attack and shows the result in the footer', async () => {
    ready({ ongoing: ONGOING });
    mocks.recordReliefSession.mockResolvedValue({ queued: false });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /relax/ }));
    await userEvent.click(screen.getByRole('button', { name: /exercise_pmr/ }));
    await userEvent.click(screen.getByRole('button', { name: 'stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'helped_yes' }));

    expect(mocks.recordReliefSession).toHaveBeenCalledWith(
      expect.objectContaining({ exercise: 'pmr', completed: false, helped: 'yes', episodeId: 7 }),
    );
    expect(await screen.findByRole('button', { name: /end_attack/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('status_saved');
  });

  it('starts an attack, then offers ending it, and can undo the start', async () => {
    ready();
    mocks.quickAddStartEpisodeNow.mockResolvedValue({ queued: false, episodeId: 42 });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /start_attack/ }));

    expect(await screen.findByRole('button', { name: /end_attack/ })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/status_started/);
    expect(screen.getByRole('button', { name: /pain_level/ })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'undo' }));

    expect(mocks.deleteEpisode).toHaveBeenCalledWith(42);
    expect(await screen.findByRole('button', { name: /start_attack/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('status_undone');
  });

  it('keeps an offline start on the device and waits for sync before ending it', async () => {
    ready();
    mocks.quickAddStartEpisodeNow.mockResolvedValue({ queued: true, outboxId: 'o1' });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /start_attack/ }));

    const end = await screen.findByRole('button', { name: /end_attack/ });

    expect(end).toBeDisabled();
    expect(end).toHaveTextContent('waiting_for_sync');
    expect(screen.getByRole('status')).toHaveTextContent('status_started_offline');

    await userEvent.click(screen.getByRole('button', { name: 'undo' }));

    expect(mocks.removeOutboxItem).toHaveBeenCalledWith('o1');
  });

  it('picks up an attack already running elsewhere', async () => {
    ready();
    mocks.quickAddStartEpisodeNow.mockRejectedValue(
      Object.assign(new Error('An attack is already in progress.'), { code: 'ONGOING_EXISTS', ongoing: { episodeId: 9 } }),
    );
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /start_attack/ }));

    expect(await screen.findByRole('button', { name: /end_attack/ })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('status_already_running');
  });

  it('ends the ongoing attack', async () => {
    ready({ ongoing: ONGOING });
    mocks.endAttackNow.mockResolvedValue({ queued: false });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /end_attack/ }));

    expect(mocks.endAttackNow).toHaveBeenCalledWith(7);
    expect(await screen.findByRole('button', { name: /start_attack/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('status_ended');
  });

  it('logs a medication in two taps, linked to the attack, and can undo it', async () => {
    ready({ ongoing: ONGOING });
    mocks.quickAddCreateIntake.mockResolvedValue({ queued: false, intakeId: 'i1' });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /took_medication/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sumatriptan/ }));

    expect(mocks.quickAddCreateIntake).toHaveBeenCalledWith(
      {
        userMedicationId: SUMA.userMedicationId,
        dose: '50',
        unit: 'mg',
        episodeId: 7,
        recordAcuteDose: true,
      },
      { label: 'Sumatriptan' },
    );
    expect(await screen.findByRole('status')).toHaveTextContent('status_med_logged(Sumatriptan)');
    expect(screen.getByRole('button', { name: /end_attack/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'undo' }));

    expect(mocks.quickAddUndoIntake).toHaveBeenCalledWith('i1');
  });

  it('explains when there are no recent medications and goes back', async () => {
    ready({ meds: [] });
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /took_medication/ }));

    expect(screen.getByText('meds_empty')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(screen.getByRole('button', { name: /start_attack/ })).toBeInTheDocument();
  });

  it('sets the pain level of the ongoing attack', async () => {
    ready({ ongoing: { ...ONGOING, intensity: 1 } });
    mocks.setAttackPain.mockResolvedValue({ queued: false });
    render(<AttackMode />);

    const pain = await screen.findByRole('button', { name: /pain_level/ });

    expect(pain).toHaveTextContent('pain_level_current(pain_mild)');

    await userEvent.click(pain);

    expect(screen.getByRole('button', { name: 'pain_mild' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'pain_severe' }));

    expect(mocks.setAttackPain).toHaveBeenCalledWith(7, 'severe');
    expect(await screen.findByRole('button', { name: /pain_level/ })).toHaveTextContent('pain_level_current(pain_severe)');
    expect(screen.getByRole('status')).toHaveTextContent('status_pain_saved(pain_severe)');
  });

  it('shows a failed save without losing state', async () => {
    ready({ ongoing: ONGOING });
    mocks.endAttackNow.mockRejectedValue(new Error('Episode not found'));
    render(<AttackMode />);

    await userEvent.click(await screen.findByRole('button', { name: /end_attack/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Episode not found');
    expect(screen.getByRole('button', { name: /end_attack/ })).toBeEnabled();
  });

  it('ignores a second tap while the first write is in flight', async () => {
    ready();
    let resolve!: (v: unknown) => void;
    mocks.quickAddStartEpisodeNow.mockReturnValue(new Promise((r) => {
      resolve = r;
    }));
    render(<AttackMode />);

    const start = await screen.findByRole('button', { name: /start_attack/ });
    await userEvent.click(start);
    await userEvent.click(start);

    expect(mocks.quickAddStartEpisodeNow).toHaveBeenCalledTimes(1);

    resolve({ queued: false, episodeId: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: /end_attack/ })).toBeInTheDocument());
  });

  it('sends users without health-data consent to the app', async () => {
    mocks.fetchAttackModeState.mockResolvedValue({ status: 'consent_required' });
    render(<AttackMode />);

    expect(await screen.findByText('consent_required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start_attack/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open_app' })).toHaveAttribute('href', '/dashboard');
  });

  it('still offers starting an attack when the state cannot load', async () => {
    mocks.fetchAttackModeState.mockRejectedValue(new TypeError('offline'));
    render(<AttackMode />);

    expect(await screen.findByRole('button', { name: /start_attack/ })).toBeEnabled();
  });
});
