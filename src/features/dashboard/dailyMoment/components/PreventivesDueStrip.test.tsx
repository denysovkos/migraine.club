import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const { fetchPreventiveDueMock, upsertPreventiveIntakeMock, tMock } = vi.hoisted(() => ({
  fetchPreventiveDueMock: vi.fn(async () => ({
    timezone: 'Europe/Berlin',
    todayLocalDate: '2025-01-01',
    hasActivePlans: true,
    due: [{
      id: 'plan-1',
      name: 'Topiramate',
      kind: 'oral',
      scheduleLabel: 'Daily',
      isOverdue: false,
      state: null,
    }],
    notDue: [],
    insight: null,
  })),
  upsertPreventiveIntakeMock: vi.fn(async () => {}),
  tMock: (key: string, vars?: Record<string, any>) => {
    if (!vars) {
      return key;
    }
    return Object.keys(vars).reduce((acc, k) => acc.replace(`{${k}}`, String(vars[k])), key);
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => tMock,
}));

vi.mock('@/features/preventives/preventivesApi', () => ({
  fetchPreventiveDue: fetchPreventiveDueMock,
  upsertPreventiveIntake: upsertPreventiveIntakeMock,
}));

vi.mock('@/features/snackbar', () => ({ showSnackbar: vi.fn() }));
vi.mock('@/utils/analytics', () => ({ trackEvent: vi.fn() }));

describe('PreventivesDueStrip', () => {
  it('renders due chip and logs intake', async () => {
    const user = userEvent.setup();
    const { PreventivesDueStrip } = await import('./PreventivesDueStrip');
    render(<PreventivesDueStrip />);

    expect(await screen.findByText('Topiramate')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Topiramate/i }));
    const takenButton = await screen.findByRole('button', { name: /state_taken/i });
    await user.click(takenButton);

    expect(upsertPreventiveIntakeMock).toHaveBeenCalledWith({
      planId: 'plan-1',
      localDate: '2025-01-01',
      state: 'taken',
    });
  });
});
