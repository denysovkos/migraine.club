import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}));

const { PressureAlertSettings } = await import('./PressureAlertSettings');

type Call = { url: string; init?: RequestInit };

function mockApi(initial: unknown, putResponse: { status: number; body: unknown } = { status: 200, body: null }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'PUT') {
      const body = putResponse.body ?? { hasLocation: true, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify(body), { status: putResponse.status });
    }
    return new Response(JSON.stringify(initial), { status: 200 });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PressureAlertSettings', () => {
  it('shows the saved threshold and offers Off plus the preset values', async () => {
    mockApi({ hasLocation: true, thresholdHpa: 8 });
    render(<PressureAlertSettings />);

    const select = await screen.findByLabelText('settings_label');

    expect(select).toHaveValue('8');
    expect(Array.from((select as HTMLSelectElement).options).map(o => o.value)).toEqual(['off', '3', '5', '8', '10']);
  });

  it('keeps a non-preset threshold selectable', async () => {
    mockApi({ hasLocation: true, thresholdHpa: 6.5 });
    render(<PressureAlertSettings />);

    expect(await screen.findByLabelText('settings_label')).toHaveValue('6.5');
  });

  it('saves a new threshold and confirms', async () => {
    const calls = mockApi({ hasLocation: true, thresholdHpa: null });
    render(<PressureAlertSettings />);

    await userEvent.selectOptions(await screen.findByLabelText('settings_label'), '5');

    expect(await screen.findByRole('status')).toHaveTextContent('settings_saved');

    const put = calls.find(c => c.init?.method === 'PUT')!;

    expect(put.url).toBe('/api/user/pressure-alert');
    expect(JSON.parse(String(put.init!.body))).toEqual({ thresholdHpa: 5 });
  });

  it('sends null when turning alerts off', async () => {
    const calls = mockApi({ hasLocation: true, thresholdHpa: 5 });
    render(<PressureAlertSettings />);

    await userEvent.selectOptions(await screen.findByLabelText('settings_label'), 'off');

    await screen.findByRole('status');

    expect(JSON.parse(String(calls.find(c => c.init?.method === 'PUT')!.init!.body))).toEqual({ thresholdHpa: null });
  });

  it('shows an error when saving fails', async () => {
    mockApi({ hasLocation: true, thresholdHpa: null }, { status: 400, body: { error: 'x' } });
    render(<PressureAlertSettings />);

    await userEvent.selectOptions(await screen.findByLabelText('settings_label'), '3');

    expect(await screen.findByRole('alert')).toHaveTextContent('settings_error');
  });

  it('asks for a location first instead of showing the control', async () => {
    mockApi({ hasLocation: false, thresholdHpa: null });
    render(<PressureAlertSettings />);

    expect(await screen.findByText('settings_no_location')).toBeInTheDocument();
    expect(screen.queryByLabelText('settings_label')).not.toBeInTheDocument();
  });
});
