import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '@/locales/en.json';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const fetchIntakeMock = vi.fn();
vi.mock('./intakeApi', () => ({ fetchIntake: () => fetchIntakeMock() }));

async function renderTile() {
  const { IntakeResumeTile } = await import('./IntakeResumeTile');
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IntakeResumeTile />
      </NextIntlClientProvider>,
    );
  });
}

describe('IntakeResumeTile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the tile when intake is not completed', async () => {
    pushMock.mockClear();
    fetchIntakeMock.mockResolvedValue({ status: 'in_progress' });

    await renderTile();

    expect(await screen.findByText(messages.Intake.resume_tile_body)).toBeInTheDocument();
  });

  it('does not crash when reading the dismissal flag throws, and still shows the tile', async () => {
    fetchIntakeMock.mockResolvedValue({ status: 'in_progress' });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage access blocked');
    });

    await renderTile();

    // An unreadable dismissal flag is treated as "not dismissed" rather than
    // propagating out of the effect and blanking the app.
    expect(await screen.findByText(messages.Intake.resume_tile_body)).toBeInTheDocument();
  });

  it('still dismisses the tile when writing the dismissal flag throws', async () => {
    fetchIntakeMock.mockResolvedValue({ status: 'in_progress' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage write blocked');
    });

    await renderTile();

    const dismissButton = await screen.findByText(messages.Intake.resume_tile_dismiss);
    await userEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText(messages.Intake.resume_tile_body)).not.toBeInTheDocument();
    });
  });
});
