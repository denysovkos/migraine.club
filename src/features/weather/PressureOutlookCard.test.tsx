import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}));

const { PressureOutlookCard } = await import('./PressureOutlookCard');

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const OUTLOOK = {
  timezone: 'Europe/Berlin',
  alertThresholdHpa: 5,
  highlightThresholdHpa: 5,
  days: [
    { date: '2026-11-18', pressureHpa: 1018, changeHpa: null, dropAtOrAboveThreshold: false },
    { date: '2026-11-19', pressureHpa: 1016, changeHpa: -2, dropAtOrAboveThreshold: false },
    { date: '2026-11-20', pressureHpa: 1009, changeHpa: -7, dropAtOrAboveThreshold: true },
    { date: '2026-11-21', pressureHpa: 1012, changeHpa: 3, dropAtOrAboveThreshold: false },
  ],
};

describe('PressureOutlookCard', () => {
  it('lists each day with change and marks falls at or above the threshold', async () => {
    mockFetch(200, OUTLOOK);
    render(<PressureOutlookCard />);

    const dropDay = await screen.findByTestId('pressure-day-2026-11-20');

    expect(dropDay).toHaveAttribute('data-drop', 'true');
    expect(dropDay).toHaveTextContent('1009');
    expect(dropDay).toHaveTextContent('-7.0');
    expect(dropDay).toHaveTextContent('drop_badge:{"threshold":5}');
    expect(screen.getByTestId('pressure-day-2026-11-21')).toHaveTextContent('+3.0');
    expect(screen.getByTestId('pressure-day-2026-11-19')).toHaveAttribute('data-drop', 'false');
    expect(screen.getByText('today')).toBeInTheDocument();
    expect(screen.getByText('subtitle:{"count":4}')).toBeInTheDocument();
  });

  it('frames the outlook as context and shows the alert state with a link to settings', async () => {
    mockFetch(200, OUTLOOK);
    render(<PressureOutlookCard />);

    expect(await screen.findByText('context_note')).toBeInTheDocument();
    expect(screen.getByText('alert_on:{"threshold":5}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'manage_link' })).toHaveAttribute('href', '/dashboard/settings/location');
  });

  it('says alerts are off when no threshold is set', async () => {
    mockFetch(200, { ...OUTLOOK, alertThresholdHpa: null });
    render(<PressureOutlookCard />);

    expect(await screen.findByText('alert_off')).toBeInTheDocument();
  });

  it('shows an unavailable message when there is no forecast data', async () => {
    mockFetch(200, { ...OUTLOOK, days: [] });
    render(<PressureOutlookCard />);

    expect(await screen.findByText('unavailable')).toBeInTheDocument();
  });

  it('renders nothing when no location is configured', async () => {
    mockFetch(404, { code: 'SETTINGS_NOT_FOUND' });
    const { container } = render(<PressureOutlookCard />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the unavailable message on a server error', async () => {
    mockFetch(500, { error: 'x' });
    render(<PressureOutlookCard />);

    expect(await screen.findByText('unavailable')).toBeInTheDocument();
  });
});
