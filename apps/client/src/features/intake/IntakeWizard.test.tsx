import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: replaceMock }) }));

const fetchIntakeMock = vi.fn();
const patchIntakeBlockMock = vi.fn();
const skipIntakeMock = vi.fn();
const completeIntakeMock = vi.fn();
vi.mock('./intakeApi', () => ({
  fetchIntake: () => fetchIntakeMock(),
  patchIntakeBlock: (p: any) => patchIntakeBlockMock(p),
  skipIntake: () => skipIntakeMock(),
  completeIntake: () => completeIntakeMock(),
}));

const showSnackbarMock = vi.fn();
vi.mock('@/features/snackbar', () => ({ showSnackbar: (p: any) => showSnackbarMock(p) }));

const messages = {
  Intake: {
    step_frequency_title: 'How often do you get migraine days?',
    band_lt1: 'Less than 1 a month',
    band_1_3: '1 to 3 a month',
    band_4_7: '4 to 7 a month',
    band_8_14: '8 to 14 a month',
    band_15_plus: '15 or more a month',
    step_triggers_title: 'Anything you already suspect?',
    custom_trigger_placeholder: 'Add your own',
    add: 'Add',
    skip: 'Skip for now',
    next: 'Next',
    finish: 'Finish',
    save_failed: 'We couldn\'t save that. Please try again.',
    step_habits_title: 'Two quick habits',
    sleep_trouble_label: 'Trouble sleeping?',
    sleep_often: 'Often',
    sleep_sometimes: 'Sometimes',
    sleep_rarely: 'Rarely',
    bed_label: 'Usual bed time',
    wake_label: 'Usual wake time',
    med_timing_label: 'How soon after onset do you take acute medication?',
    timing_lt30: 'Within 30 minutes',
    timing_30_120: '30 minutes to 2 hours',
    timing_gt120: 'More than 2 hours',
    timing_varies: 'It varies',
  },
  Factors: {
    builtins: {
      trigger: {
        sleep_issue: 'Poor sleep',
        stress: 'Stress',
        skipped_meal: 'Skipped meal',
        dehydration: 'Dehydration',
        caffeine: 'Caffeine',
        alcohol: 'Alcohol',
        screen_time: 'Screen time',
        weather: 'Weather',
        hormones: 'Hormones',
        exercise: 'Exercise',
        other: 'Other',
      },
    },
  },
};

async function renderWizard() {
  const { IntakeWizard } = await import('./IntakeWizard');
  let utils!: ReturnType<typeof render>;
  // The wizard's mount effect calls fetchIntake() and resolves the loaded
  // answers via setState. Wrapping the render in an async act() flushes that
  // microtask before we start interacting, so the state update lands inside
  // act() instead of racing it once we start querying/clicking.
  await act(async () => {
    utils = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IntakeWizard />
      </NextIntlClientProvider>,
    );
  });
  return utils;
}

describe('IntakeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchIntakeBlockMock.mockResolvedValue({});
  });

  it('resumes at the stored current step', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 1,
      version: 1,
      answers: { frequency: { band: '4_7' }, triggers: null, medications: null, habits: null },
    });

    await renderWizard();

    expect(await screen.findByText('Anything you already suspect?')).toBeInTheDocument();
  });

  it('autosaves the frequency block when advancing', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 0,
      version: 1,
      answers: { frequency: null, triggers: null, medications: null, habits: null },
    });

    await renderWizard();
    await userEvent.click(await screen.findByText('4 to 7 a month'));
    await userEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(patchIntakeBlockMock).toHaveBeenCalledWith({ block: 'frequency', value: { band: '4_7' } });
    });
  });

  it('skip sends the user to the dashboard', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 0,
      version: 1,
      answers: { frequency: null, triggers: null, medications: null, habits: null },
    });
    skipIntakeMock.mockResolvedValue(undefined);

    await renderWizard();
    await userEvent.click(await screen.findByText('Skip for now'));

    await waitFor(() => {
      expect(skipIntakeMock).toHaveBeenCalled();
      expect(replaceMock).toHaveBeenCalledWith('/dashboard');
    });

    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('completes and replaces the dashboard entry when finishing the last step', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 3,
      version: 1,
      answers: { frequency: { band: '4_7' }, triggers: null, medications: null, habits: null },
    });
    completeIntakeMock.mockResolvedValue(undefined);

    await renderWizard();
    await userEvent.click(await screen.findByText('Finish'));

    await waitFor(() => {
      expect(completeIntakeMock).toHaveBeenCalled();
      expect(replaceMock).toHaveBeenCalledWith('/dashboard');
    });

    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('shows an error and does not advance when saving the frequency block fails', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 0,
      version: 1,
      answers: { frequency: null, triggers: null, medications: null, habits: null },
    });
    patchIntakeBlockMock.mockRejectedValueOnce(new Error('server error'));

    await renderWizard();
    await userEvent.click(await screen.findByText('4 to 7 a month'));
    await userEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'We couldn\'t save that. Please try again.' });
    });

    // The step must not have advanced — the user's answer stays on screen, unsaved.
    expect(screen.queryByText('Anything you already suspect?')).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows an error and stays on the wizard when skip fails', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 0,
      version: 1,
      answers: { frequency: null, triggers: null, medications: null, habits: null },
    });
    skipIntakeMock.mockRejectedValueOnce(new Error('server error'));

    await renderWizard();
    await userEvent.click(await screen.findByText('Skip for now'));

    await waitFor(() => {
      expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'We couldn\'t save that. Please try again.' });
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
