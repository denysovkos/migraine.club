import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOrQueueMock } = vi.hoisted(() => ({ sendOrQueueMock: vi.fn() }));
vi.mock('@/libs/offline/outbox', () => ({ sendOrQueue: sendOrQueueMock }));

const { recordReliefSession } = await import('./reliefApi');

const INPUT = {
  exercise: 'pmr' as const,
  startedAt: new Date('2026-11-18T11:55:00Z'),
  durationSeconds: 61.6,
  completed: false,
  helped: 'no' as const,
  episodeId: 7,
};

beforeEach(() => {
  sendOrQueueMock.mockReset();
});

describe('recordReliefSession', () => {
  it('posts the session with the device start time and whole seconds, offline-capable', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: false, response: new Response('{}', { status: 201 }) });

    await expect(recordReliefSession(INPUT)).resolves.toEqual({ queued: false });
    expect(sendOrQueueMock).toHaveBeenCalledWith({
      url: '/api/relief-sessions',
      method: 'POST',
      body: {
        exercise: 'pmr',
        startedAt: '2026-11-18T11:55:00.000Z',
        durationSeconds: 62,
        completed: false,
        helped: 'no',
        episodeId: 7,
      },
      kind: 'relief',
    });
  });

  it('reports a queued session', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'x' });

    await expect(recordReliefSession(INPUT)).resolves.toEqual({ queued: true });
  });

  it('throws the server error', async () => {
    sendOrQueueMock.mockResolvedValue({
      queued: false,
      response: new Response(JSON.stringify({ error: 'Episode not found' }), { status: 404 }),
    });

    await expect(recordReliefSession(INPUT)).rejects.toThrow('Episode not found');
  });
});
