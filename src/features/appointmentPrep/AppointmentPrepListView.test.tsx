import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const {
  createAppointmentPrepMock,
  listAppointmentPrepsMock,
  pushMock,
} = vi.hoisted(() => ({
  createAppointmentPrepMock: vi.fn(async () => ({ id: 'prep-2' })),
  listAppointmentPrepsMock: vi.fn(async () => ([
    {
      id: 'prep-1',
      appointmentDate: '2026-05-01',
      visitLabel: 'Neurology follow-up',
      visitReason: 'Review worsening attacks',
    },
  ])),
  pushMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('./appointmentPrepApi', () => ({
  createAppointmentPrep: createAppointmentPrepMock,
  listAppointmentPreps: listAppointmentPrepsMock,
}));

describe('AppointmentPrepListView', () => {
  it('lists existing drafts and creates a new prep draft', async () => {
    const { AppointmentPrepListView } = await import('./AppointmentPrepListView');

    render(<AppointmentPrepListView />);

    expect(await screen.findByText('Neurology follow-up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'create_button' }));

    await waitFor(() => {
      expect(createAppointmentPrepMock).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      );
    });

    expect(listAppointmentPrepsMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/dashboard/reports/appointment-prep/prep-2');
  });
});
