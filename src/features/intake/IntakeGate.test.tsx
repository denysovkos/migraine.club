import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replaceMock = vi.fn();
// Real Next.js useRouter() returns a stable reference across renders. A
// mock that returns a fresh object every call breaks that assumption and
// causes IntakeGate's [router] effect dependency to fire on every re-render.
const routerMock = { replace: replaceMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));

const fetchIntakeMock = vi.fn();
vi.mock('./intakeApi', () => ({ fetchIntake: () => fetchIntakeMock() }));

async function renderGate() {
  const { IntakeGate } = await import('./IntakeGate');
  await act(async () => {
    render(<IntakeGate><div>dashboard</div></IntakeGate>);
  });
}

afterEach(() => {
  // A faked-timer test that throws before restoring real timers must not
  // leave fake timers active for the next test (waitFor/findByText poll
  // internally and would hang forever against a frozen fake clock).
  vi.useRealTimers();
});

describe('IntakeGate', () => {
  it('redirects to onboarding when intake is in progress', async () => {
    replaceMock.mockClear();
    fetchIntakeMock.mockResolvedValue({ status: 'in_progress' });

    await renderGate();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('renders the dashboard when intake was skipped', async () => {
    replaceMock.mockClear();
    fetchIntakeMock.mockResolvedValue({ status: 'skipped' });

    await renderGate();

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the dashboard when intake is completed', async () => {
    replaceMock.mockClear();
    fetchIntakeMock.mockResolvedValue({ status: 'completed' });

    await renderGate();

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('fails open — renders the dashboard when the status request errors', async () => {
    replaceMock.mockClear();
    fetchIntakeMock.mockRejectedValue(new Error('boom'));

    await renderGate();

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('fails open — renders the dashboard when the status request never resolves', async () => {
    replaceMock.mockClear();
    vi.useFakeTimers();
    fetchIntakeMock.mockReturnValue(new Promise(() => {}));

    await renderGate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not redirect a user already on the dashboard when a late response arrives after the timeout', async () => {
    replaceMock.mockClear();
    vi.useFakeTimers();
    let resolveFetch: (dto: { status: string }) => void = () => {};
    fetchIntakeMock.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    await renderGate();

    // Timeout fires first: dashboard renders while the request is still pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('dashboard')).toBeInTheDocument();

    // The stale request finally resolves — it must not yank the user away.
    await act(async () => {
      resolveFetch({ status: 'in_progress' });
      await Promise.resolve();
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText('dashboard')).toBeInTheDocument();

    vi.useRealTimers();
  });
});
