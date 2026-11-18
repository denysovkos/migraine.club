import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchPainReadings: vi.fn(),
  addPainReading: vi.fn(),
  deletePainReading: vi.fn(),
}));

vi.mock('./painTimelineApi', () => mocks);
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));

const { PainTimeline } = await import('./PainTimeline');

const ENDED = {
  episodeId: 7,
  startTime: '2026-11-17T08:00:00.000Z',
  onsetAt: null,
  endTime: '2026-11-17T14:00:00.000Z',
  isOngoing: false,
};

const R1 = { id: 'r1', episodeId: 7, recordedAt: '2026-11-17T09:00:00.000Z', intensity: 4 };
const R2 = { id: 'r2', episodeId: 7, recordedAt: '2026-11-17T12:00:00.000Z', intensity: 2 };

beforeEach(() => {
  for (const m of Object.values(mocks)) {
    m.mockReset();
  }
});

describe('PainTimeline', () => {
  it('charts and lists the readings with the peak', async () => {
    mocks.fetchPainReadings.mockResolvedValue([R2, R1]);
    render(<PainTimeline {...ENDED} />);

    const chart = await screen.findByRole('img');

    expect(chart).toHaveAttribute('aria-label', expect.stringContaining('chart_label(2,'));
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect(screen.getByTestId('pain-timeline-peak')).toHaveTextContent('peak(4 · level_4)');

    const rows = screen.getAllByTestId('pain-reading-row');

    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('level_4'),
      expect.stringContaining('level_2'),
    ]);
    expect(screen.queryAllByTestId('pain-timeline-midnight')).toHaveLength(0);
    expect(mocks.fetchPainReadings).toHaveBeenCalledWith(7, expect.anything());
  });

  it('explains the timeline when there are no readings', async () => {
    mocks.fetchPainReadings.mockResolvedValue([]);
    render(<PainTimeline {...ENDED} />);

    expect(await screen.findByText('empty')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'add_button' })).toBeDisabled();
  });

  it('marks each midnight of a multi-day attack', async () => {
    mocks.fetchPainReadings.mockResolvedValue([
      { id: 'a', episodeId: 7, recordedAt: '2026-11-16T22:00:00.000Z', intensity: 3 },
      { id: 'b', episodeId: 7, recordedAt: '2026-11-18T10:00:00.000Z', intensity: 5 },
    ]);
    render(<PainTimeline {...ENDED} startTime="2026-11-16T20:00:00.000Z" endTime="2026-11-18T12:00:00.000Z" />);

    await screen.findByRole('img');

    expect(screen.getAllByTestId('pain-timeline-midnight').length).toBeGreaterThanOrEqual(1);
  });

  it('adds a reading at the chosen time and reports the new peak', async () => {
    const user = userEvent.setup();
    const onPeakChange = vi.fn();
    mocks.fetchPainReadings.mockResolvedValue([R2]);
    const saved = { id: 'r3', episodeId: 7, recordedAt: '2026-11-17T10:30:00.000Z', intensity: 5 };
    mocks.addPainReading.mockResolvedValue({ queued: false, reading: saved, peakIntensity: 5 });
    render(<PainTimeline {...ENDED} onPeakChange={onPeakChange} />);

    await screen.findByRole('img');
    // Default time for an attack that is over is its end.
    const time = screen.getByLabelText('time_label') as HTMLInputElement;

    expect(new Date(time.value).getTime()).toBe(new Date('2026-11-17T14:00:00.000Z').getTime());

    await user.click(screen.getByRole('button', { name: 'aria_label(5+,level_5)' }));
    const local = new Date('2026-11-17T10:30:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(time, {
      target: { value: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}` },
    });
    await user.click(screen.getByRole('button', { name: 'add_button' }));

    await waitFor(() => expect(screen.getAllByTestId('pain-reading-row')).toHaveLength(2));

    expect(mocks.addPainReading).toHaveBeenCalledWith(7, { intensity: 5, recordedAt: local });
    expect(onPeakChange).toHaveBeenCalledWith(5);
    expect(screen.getByTestId('pain-timeline-peak')).toHaveTextContent('level_5');
  });

  it('snaps a time picked in the onset minute to the onset', async () => {
    const user = userEvent.setup();
    mocks.fetchPainReadings.mockResolvedValue([]);
    mocks.addPainReading.mockResolvedValue({ queued: false, reading: { ...R1, id: 'x' }, peakIntensity: 4 });
    render(<PainTimeline {...ENDED} startTime="2026-11-17T08:00:30.000Z" />);

    await screen.findByText('empty');
    const time = screen.getByLabelText('time_label') as HTMLInputElement;
    fireEvent.change(time, { target: { value: time.min } });
    await user.click(screen.getByRole('button', { name: 'aria_label(4,level_4)' }));
    await user.click(screen.getByRole('button', { name: 'add_button' }));

    await waitFor(() => expect(mocks.addPainReading).toHaveBeenCalled());

    expect(mocks.addPainReading.mock.calls[0]![1].recordedAt).toEqual(new Date('2026-11-17T08:00:30.000Z'));
  });

  it('explains a refused time', async () => {
    const user = userEvent.setup();
    mocks.fetchPainReadings.mockResolvedValue([]);
    mocks.addPainReading.mockRejectedValue(Object.assign(new Error('x'), { reason: 'after_end' }));
    render(<PainTimeline {...ENDED} />);

    await screen.findByText('empty');
    await user.click(screen.getByRole('button', { name: 'aria_label(3,level_3)' }));
    await user.click(screen.getByRole('button', { name: 'add_button' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('error_after_end');
  });

  it('shows a reading kept on the device as pending', async () => {
    const user = userEvent.setup();
    mocks.fetchPainReadings.mockResolvedValue([]);
    mocks.addPainReading.mockResolvedValue({ queued: true });
    render(<PainTimeline {...ENDED} isOngoing endTime={null} />);

    await screen.findByText('empty');
    await user.click(screen.getByRole('button', { name: 'aria_label(2,level_2)' }));
    await user.click(screen.getByRole('button', { name: 'add_button' }));

    expect(await screen.findByRole('status')).toHaveTextContent('saved_offline');

    const row = screen.getByTestId('pain-reading-row');

    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('deletes a reading and reports the peak that remains', async () => {
    const user = userEvent.setup();
    const onPeakChange = vi.fn();
    mocks.fetchPainReadings.mockResolvedValue([R1, R2]);
    mocks.deletePainReading.mockResolvedValue(2);
    render(<PainTimeline {...ENDED} onPeakChange={onPeakChange} />);

    await screen.findByRole('img');
    const [first] = screen.getAllByTestId('pain-reading-row');
    await user.click(within(first!).getByRole('button'));

    await waitFor(() => expect(screen.getAllByTestId('pain-reading-row')).toHaveLength(1));

    expect(mocks.deletePainReading).toHaveBeenCalledWith(7, 'r1');
    expect(onPeakChange).toHaveBeenCalledWith(2);
  });

  it('shows a load failure', async () => {
    mocks.fetchPainReadings.mockRejectedValue(new Error('boom'));
    render(<PainTimeline {...ENDED} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('load_error');
  });
});
