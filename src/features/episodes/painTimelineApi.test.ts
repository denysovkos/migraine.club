import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOrQueueMock } = vi.hoisted(() => ({ sendOrQueueMock: vi.fn() }));
vi.mock('@/libs/offline/outbox', () => ({ sendOrQueue: sendOrQueueMock }));

const { addPainReading, deletePainReading, fetchPainReadings } = await import('./painTimelineApi');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendOrQueueMock.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('fetchPainReadings', () => {
  it('returns the readings', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ readings: [{ id: 'a' }] })));

    await expect(fetchPainReadings(3)).resolves.toEqual([{ id: 'a' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/episodes/3/pain-readings', expect.objectContaining({ cache: 'no-store' }));
  });

  it('throws the server error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Episode not found' }), { status: 404 }));

    await expect(fetchPainReadings(3)).rejects.toThrow('Episode not found');
  });
});

describe('addPainReading', () => {
  it('posts the level with the captured time, offline-capable', async () => {
    sendOrQueueMock.mockResolvedValue({
      queued: false,
      response: new Response(JSON.stringify({ reading: { id: 'r' }, peakIntensity: 4 }), { status: 201 }),
    });

    const result = await addPainReading(3, { intensity: 4, recordedAt: new Date('2026-11-17T01:00:00Z') });

    expect(result).toEqual({ queued: false, reading: { id: 'r' }, peakIntensity: 4 });
    expect(sendOrQueueMock).toHaveBeenCalledWith({
      url: '/api/episodes/3/pain-readings',
      method: 'POST',
      body: { intensity: 4, recordedAt: '2026-11-17T01:00:00.000Z' },
      kind: 'attack_update',
    });
  });

  it('reports a queued reading', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'x' });

    await expect(addPainReading(3, { intensity: 2, recordedAt: new Date() })).resolves.toEqual({ queued: true });
  });

  it('exposes the reason a time was refused', async () => {
    sendOrQueueMock.mockResolvedValue({
      queued: false,
      response: new Response(JSON.stringify({ error: 'x', code: 'VALIDATION_ERROR', details: { reason: 'before_start' } }), { status: 400 }),
    });

    await expect(addPainReading(3, { intensity: 2, recordedAt: new Date() }))
      .rejects
      .toMatchObject({ code: 'VALIDATION_ERROR', reason: 'before_start' });
  });
});

describe('deletePainReading', () => {
  it('returns the peak after the delete', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, peakIntensity: 2 })));

    await expect(deletePainReading(3, 'abc')).resolves.toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/episodes/3/pain-readings/abc', { method: 'DELETE' });
  });

  it('returns null when no readings remain, and throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, peakIntensity: null })));

    await expect(deletePainReading(3, 'abc')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));

    await expect(deletePainReading(3, 'abc')).rejects.toThrow('Failed to delete pain reading');
  });
});
