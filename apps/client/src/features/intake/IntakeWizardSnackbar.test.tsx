import messages from '@migraine/locales/en.json';
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

// The consent guard normally hits /api/user/consent; stub the hook directly
// so this test isn't about consent, it's about the snackbar actually
// rendering once the guard lets the wizard through.
vi.mock('@/hooks/useHealthDataConsent', () => ({
  useHealthDataConsent: () => ({
    hasConsent: true,
    isLoading: false,
    error: null,
    giveConsent: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// Deliberately does NOT mock '@/features/snackbar'. IntakeWizard.test.tsx mocks
// that module wholesale, which only proves showSnackbar() was *called* — it
// can't catch a route where the viewport never mounts. This test renders the
// actual onboarding route component (src/app/[locale]/(auth)/onboarding/page.tsx)
// with the real snackbar store, so it fails if that page stops mounting a
// SnackbarViewport and the failure message stops reaching the DOM.

async function renderOnboardingPage() {
  const { default: OnboardingPage } = await import('../../app/[locale]/(auth)/onboarding/page');

  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OnboardingPage />
      </NextIntlClientProvider>,
    );
  });
}

describe('onboarding page + real SnackbarViewport composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the save-failed message in the DOM when the frequency save fails', async () => {
    fetchIntakeMock.mockResolvedValue({
      status: 'in_progress',
      currentStep: 0,
      version: 1,
      answers: { frequency: null, triggers: null, medications: null, habits: null },
    });
    patchIntakeBlockMock.mockRejectedValueOnce(new Error('server error'));

    await renderOnboardingPage();
    await userEvent.click(await screen.findByText(messages.Intake.band_4_7));
    await userEvent.click(screen.getByText(messages.Intake.next));

    await waitFor(() => {
      expect(screen.getByText(messages.Intake.save_failed)).toBeInTheDocument();
    });
  });
});
