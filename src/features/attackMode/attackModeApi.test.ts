import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOrQueueMock, fetchOngoingEpisodeMock } = vi.hoisted(() => ({
  sendOrQueueMock: vi.fn(),
  fetchOngoingEpisodeMock: vi.fn(),
}));

vi.mock('@/libs/offline/outbox', () => ({ sendOrQueue: sendOrQueueMock }));
vi.mock('@/features/dashboard/migrennity/dataHelpers', () => ({ fetchOngoingEpisode: fetchOngoingEpisodeMock }));

const { endAttackNow, fetchAttackModeState, setAttackPain } = await import('./attackModeApi');

function med(id: string) {
  return { userMedicationId: id, label: `Med ${id}`, suggestedDose: null, suggestedUnit: null, unitIsCustom: false };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendOrQueueMock.mockReset();
  fetchOngoingEpisodeMock.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('fetchAttackModeState', () => {
  it('returns the ongoing attack and at most three medications', async () => {
    fetchOngoingEpisodeMock.mockResolvedValue({ id: 7, startTime: '2026-11-17T08:00:00.000Z', intensity: 4 });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      topMeds: ['1', '2', '3', '4', '5'].map(med),
      hasOngoingEpisode: true,
    })));

    const state = await fetchAttackModeState();

    expect(fetchMock).toHaveBeenCalledWith('/api/quick-add/suggestions', expect.objectContaining({ cache: 'no-store' }));
    expect(state).toEqual({
      status: 'ready',
      ongoing: { id: 7, startTime: '2026-11-17T08:00:00.000Z', intensity: 4 },
      meds: ['1', '2', '3'].map(med),
    });
  });

  it('reports missing health-data consent', async () => {
    fetchOngoingEpisodeMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'CONSENT_REQUIRED' }), { status: 403 }));

    await expect(fetchAttackModeState()).resolves.toEqual({ status: 'consent_required' });
  });

  it('still works without suggestions (offline or server error)', async () => {
    fetchOngoingEpisodeMock.mockRejectedValue(new TypeError('offline'));
    fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(fetchAttackModeState()).resolves.toEqual({ status: 'ready', ongoing: null, meds: [] });

    fetchOngoingEpisodeMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(fetchAttackModeState()).resolves.toEqual({ status: 'ready', ongoing: null, meds: [] });
  });
});

describe('endAttackNow', () => {
  it('ends the attack with the time of the tap, queueable offline', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: false, response: new Response('{}') });
    const now = new Date('2026-11-17T10:30:00.000Z');

    await expect(endAttackNow(7, now)).resolves.toEqual({ queued: false });
    expect(sendOrQueueMock).toHaveBeenCalledWith({
      url: '/api/episodes/7',
      method: 'PATCH',
      body: { endNow: true, endedAt: '2026-11-17T10:30:00.000Z' },
      kind: 'attack_update',
    });
  });

  it('reports a queued write', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'o1' });

    await expect(endAttackNow(7)).resolves.toEqual({ queued: true });
  });

  it('throws the server error', async () => {
    sendOrQueueMock.mockResolvedValue({
      queued: false,
      response: new Response(JSON.stringify({ error: 'Episode not found' }), { status: 404 }),
    });

    await expect(endAttackNow(7)).rejects.toThrow('Episode not found');
  });
});

describe('setAttackPain', () => {
  it('stores the mapped 1–5 intensity', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: false, response: new Response('{}') });

    await setAttackPain(7, 'severe');

    expect(sendOrQueueMock).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/episodes/7',
      method: 'PATCH',
      body: { intensity: 4 },
      kind: 'attack_update',
    }));
  });

  it('falls back to a generic error message', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: false, response: new Response('nope', { status: 500 }) });

    await expect(setAttackPain(7, 'mild')).rejects.toThrow('Failed to save pain level');
  });
});
