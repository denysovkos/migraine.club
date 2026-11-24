import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./WeatherSettingsForm', () => ({
  WeatherSettingsForm: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button type="button" onClick={onSuccess}>save location</button>
  ),
}));
vi.mock('./PressureAlertSettings', () => ({
  PressureAlertSettings: ({ refreshKey }: { refreshKey: number }) => <div data-testid="pressure">{refreshKey}</div>,
}));

const { LocationSettingsPanel } = await import('./LocationSettingsPanel');

describe('LocationSettingsPanel', () => {
  it('refreshes the pressure alert setting after the location is saved', async () => {
    render(<LocationSettingsPanel />);

    expect(screen.getByTestId('pressure')).toHaveTextContent('0');

    await userEvent.click(screen.getByRole('button', { name: 'save location' }));

    expect(screen.getByTestId('pressure')).toHaveTextContent('1');
  });
});
