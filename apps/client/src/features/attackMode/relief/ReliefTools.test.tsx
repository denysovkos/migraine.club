import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordReliefSession: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  speechAvailable: vi.fn(() => true),
  readVoicePref: vi.fn(() => false),
  writeVoicePref: vi.fn(),
}));

vi.mock('./reliefApi', () => ({ recordReliefSession: mocks.recordReliefSession }));
vi.mock('./speech', () => ({
  speak: mocks.speak,
  stopSpeaking: mocks.stopSpeaking,
  speechAvailable: mocks.speechAvailable,
  readVoicePref: mocks.readVoicePref,
  writeVoicePref: mocks.writeVoicePref,
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'uk',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));

const { ReliefTools } = await import('./ReliefTools');
const { totalSeconds } = await import('./reliefExercises');

const START = new Date('2026-11-18T20:00:00Z');

function setup(episodeId: number | null = 7) {
  const onBack = vi.fn();
  const onDone = vi.fn();
  render(<ReliefTools episodeId={episodeId} onBack={onBack} onDone={onDone} />);
  return { onBack, onDone };
}

/** Advance the clock and let the 250 ms ticker re-render. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  for (const m of Object.values(mocks)) {
    m.mockClear();
  }
  mocks.speechAvailable.mockReturnValue(true);
  mocks.readVoicePref.mockReturnValue(false);
  mocks.recordReliefSession.mockResolvedValue({ queued: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReliefTools', () => {
  it('lists the three exercises with their length, plus voice and back', () => {
    const { onBack } = setup();

    expect(screen.getByRole('button', { name: /exercise_breathing/ })).toHaveTextContent('exercise_sub(3,desc_breathing)');
    expect(screen.getByRole('button', { name: /exercise_pmr/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exercise_relaxation/ })).toHaveTextContent('exercise_sub(4,desc_relaxation)');
    expect(screen.getByRole('button', { name: 'voice_off' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(onBack).toHaveBeenCalled();
  });

  it('hides the voice switch where the device cannot speak', () => {
    mocks.speechAvailable.mockReturnValue(false);
    setup();

    expect(screen.queryByRole('button', { name: /voice_/ })).not.toBeInTheDocument();
  });

  it('paces breathing by the clock: intro, then in for 4 and out for 6 with a countdown', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /exercise_breathing/ }));

    expect(screen.getByTestId('relief-step')).toHaveTextContent('step_breathing_intro');
    expect(screen.queryByTestId('relief-countdown')).not.toBeInTheDocument();

    advance(10_000);

    expect(screen.getByTestId('relief-step')).toHaveTextContent('step_breathe_in');
    expect(screen.getByTestId('relief-countdown')).toHaveTextContent('4');
    expect(screen.getByText('breath_count(1,18)')).toBeInTheDocument();

    advance(4_000);

    expect(screen.getByTestId('relief-step')).toHaveTextContent('step_breathe_out');
    expect(screen.getByTestId('relief-countdown')).toHaveTextContent('6');

    advance(6_000);

    expect(screen.getByText('breath_count(2,18)')).toBeInTheDocument();
    // Voice is off by default.
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it('asks whether it helped after the last step and records a completed session', async () => {
    const { onDone } = setup(7);
    fireEvent.click(screen.getByRole('button', { name: /exercise_relaxation/ }));

    advance(totalSeconds('relaxation') * 1000 + 500);

    expect(screen.getByTestId('relief-feedback')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'helped_a_little' }));
    });

    expect(mocks.recordReliefSession).toHaveBeenCalledWith({
      exercise: 'relaxation',
      startedAt: START,
      durationSeconds: totalSeconds('relaxation'),
      completed: true,
      helped: 'a_little',
      episodeId: 7,
    });
    expect(onDone).toHaveBeenCalledWith('status_saved');
  });

  it('records a stopped session with the time actually spent, and a skipped answer', async () => {
    const { onDone } = setup(null);
    fireEvent.click(screen.getByRole('button', { name: /exercise_pmr/ }));
    advance(42_000);
    fireEvent.click(screen.getByRole('button', { name: 'stop' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'helped_skip' }));
    });

    expect(mocks.recordReliefSession).toHaveBeenCalledWith(
      expect.objectContaining({ exercise: 'pmr', completed: false, helped: null, episodeId: null }),
    );
    expect(mocks.recordReliefSession.mock.calls[0]![0].durationSeconds).toBeCloseTo(42, 0);
    expect(onDone).toHaveBeenCalledWith('status_saved');
  });

  it('tells the user when the session was kept on the device', async () => {
    mocks.recordReliefSession.mockResolvedValue({ queued: true });
    const { onDone } = setup();
    fireEvent.click(screen.getByRole('button', { name: /exercise_breathing/ }));
    fireEvent.click(screen.getByRole('button', { name: 'stop' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'helped_no' }));
    });

    expect(onDone).toHaveBeenCalledWith('status_saved_offline');
  });

  it('shows an error line when saving fails', async () => {
    mocks.recordReliefSession.mockRejectedValue(null);
    const { onDone } = setup();
    fireEvent.click(screen.getByRole('button', { name: /exercise_breathing/ }));
    fireEvent.click(screen.getByRole('button', { name: 'stop' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'helped_no' }));
    });

    expect(onDone).toHaveBeenCalledWith('status_error');
  });

  it('reads each step aloud once when voice is on, in the app language, and goes quiet on stop', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'voice_off' }));

    expect(mocks.writeVoicePref).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: /exercise_breathing/ }));

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.speak).toHaveBeenLastCalledWith('step_breathing_intro', 'uk');

    advance(5_000); // same step, several ticks

    expect(mocks.speak).toHaveBeenCalledTimes(1);

    advance(5_000);

    expect(mocks.speak).toHaveBeenLastCalledWith('step_breathe_in', 'uk');
    expect(mocks.speak).toHaveBeenCalledTimes(2);

    mocks.stopSpeaking.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'stop' }));

    expect(mocks.stopSpeaking).toHaveBeenCalled();
  });

  it('remembers voice being on and can be muted mid-session', () => {
    mocks.readVoicePref.mockReturnValue(true);
    setup();
    fireEvent.click(screen.getByRole('button', { name: /exercise_breathing/ }));

    expect(mocks.speak).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'voice_on' }));

    expect(mocks.writeVoicePref).toHaveBeenLastCalledWith(false);
    expect(mocks.stopSpeaking).toHaveBeenCalled();

    advance(10_000);

    expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
});
