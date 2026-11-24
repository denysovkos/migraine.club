import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client API helpers route every attack/dose/diary/factor write through
 * the offline outbox and stamp it with the time captured on the device.
 */

const sendOrQueueMock = vi.fn();
vi.mock('@/libs/offline/outbox', () => ({ sendOrQueue: sendOrQueueMock }));

const setLastAttackTypeMock = vi.fn();
vi.mock('@/features/episodes/attackTypePrefs', () => ({
  getLastAttackType: () => 'headache',
  setLastAttackType: setLastAttackTypeMock,
}));

const NOW = new Date('2026-11-16T12:00:00.000Z');

function sent(status: number, body: unknown) {
  return { queued: false, response: new Response(JSON.stringify(body), { status }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sendOrQueueMock.mockReset();
  setLastAttackTypeMock.mockReset();
});

describe('quickAddStartEpisodeNow', () => {
  it('sends the tap time and returns the new attack id', async () => {
    sendOrQueueMock.mockResolvedValue(sent(201, { episodeId: 5 }));
    const { quickAddStartEpisodeNow } = await import('./quickAddApi');

    const res = await quickAddStartEpisodeNow({ attackType: 'migraine' });

    expect(res).toEqual({ queued: false, episodeId: 5 });
    expect(sendOrQueueMock).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/quick-add/episode',
      method: 'POST',
      kind: 'attack',
      body: { attackType: 'migraine', startedAt: NOW.toISOString() },
    }));
    expect(setLastAttackTypeMock).toHaveBeenCalledWith('migraine');
  });

  it('falls back to the last attack type', async () => {
    sendOrQueueMock.mockResolvedValue(sent(201, { episodeId: 5 }));
    const { quickAddStartEpisodeNow } = await import('./quickAddApi');

    await quickAddStartEpisodeNow();

    expect(sendOrQueueMock.mock.calls[0]![0].body.attackType).toBe('headache');
  });

  it('sends a past diary day without a start time', async () => {
    sendOrQueueMock.mockResolvedValue(sent(201, { episodeId: 5 }));
    const { quickAddStartEpisodeNow } = await import('./quickAddApi');

    await quickAddStartEpisodeNow({ attackType: 'migraine', localDate: '2026-11-10' });

    expect(sendOrQueueMock.mock.calls[0]![0].body).toEqual({ attackType: 'migraine', localDate: '2026-11-10' });
  });

  it('reports a queued attack', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'q1' });
    const { quickAddStartEpisodeNow } = await import('./quickAddApi');

    expect(await quickAddStartEpisodeNow({ attackType: 'migraine' })).toEqual({ queued: true, outboxId: 'q1' });
    expect(setLastAttackTypeMock).toHaveBeenCalledWith('migraine');
  });

  it('surfaces server errors with their code', async () => {
    sendOrQueueMock.mockResolvedValue(sent(409, { error: 'An attack is already in progress.', code: 'ONGOING_EXISTS' }));
    const { quickAddStartEpisodeNow } = await import('./quickAddApi');

    await expect(quickAddStartEpisodeNow()).rejects.toMatchObject({
      message: 'An attack is already in progress.',
      code: 'ONGOING_EXISTS',
    });
  });
});

describe('quickAddCreateIntake', () => {
  it('stamps the tap time unless the caller provided one', async () => {
    sendOrQueueMock.mockImplementation(async () => sent(201, { intakeId: 'i', userMedicationId: 'm' }));
    const { quickAddCreateIntake } = await import('./quickAddApi');

    const res = await quickAddCreateIntake({ customName: 'Ibuprofen' });
    await quickAddCreateIntake({ customName: 'Ibuprofen', takenAt: '2026-11-16T08:00:00.000Z' }, { label: 'Ibu' });

    expect(res).toMatchObject({ queued: false, intakeId: 'i' });
    expect(sendOrQueueMock.mock.calls[0]![0]).toMatchObject({
      url: '/api/quick-add/medication-intake',
      kind: 'dose',
      label: 'Ibuprofen',
      body: { customName: 'Ibuprofen', takenAt: NOW.toISOString() },
    });
    expect(sendOrQueueMock.mock.calls[1]![0]).toMatchObject({
      label: 'Ibu',
      body: { takenAt: '2026-11-16T08:00:00.000Z' },
    });
  });

  it('reports a queued dose', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'q2' });
    const { quickAddCreateIntake } = await import('./quickAddApi');

    expect(await quickAddCreateIntake({ customName: 'x' })).toEqual({ queued: true, outboxId: 'q2' });
  });

  it('throws the server error', async () => {
    sendOrQueueMock.mockResolvedValue(sent(400, { error: 'Validation error' }));
    const { quickAddCreateIntake } = await import('./quickAddApi');

    await expect(quickAddCreateIntake({ customName: 'x' })).rejects.toThrow('Validation error');
  });
});

describe('createAcuteDose', () => {
  it('stamps the tap time and keeps the label out of the payload', async () => {
    sendOrQueueMock.mockResolvedValue(sent(201, { doseId: 'd', attackId: null }));
    const { createAcuteDose } = await import('./acuteMedsApi');

    const res = await createAcuteDose({ medicationId: 'm', dose: '50', label: 'Sumatriptan' });

    expect(res).toEqual({ queued: false, doseId: 'd', attackId: null });
    expect(sendOrQueueMock).toHaveBeenCalledWith({
      url: '/api/acute-doses',
      method: 'POST',
      kind: 'dose',
      label: 'Sumatriptan',
      body: { medicationId: 'm', dose: '50', takenAt: NOW.toISOString() },
    });
  });

  it('reports a queued dose and throws server errors', async () => {
    const { createAcuteDose } = await import('./acuteMedsApi');
    sendOrQueueMock.mockResolvedValueOnce({ queued: true, id: 'q3' });

    expect(await createAcuteDose({ medicationId: 'm' })).toEqual({ queued: true, outboxId: 'q3' });

    sendOrQueueMock.mockResolvedValueOnce(sent(404, { error: 'Medication not found' }));

    await expect(createAcuteDose({ medicationId: 'm' })).rejects.toThrow('Medication not found');
  });
});

describe('upsertDiaryEntry', () => {
  it('returns the saved entry online and null when queued', async () => {
    const { upsertDiaryEntry } = await import('@/features/diary/diaryApi');
    sendOrQueueMock.mockResolvedValueOnce(sent(200, { localDate: '2026-11-16', dayType: 'headache_free' }));

    expect(await upsertDiaryEntry({ localDate: '2026-11-16', patch: { dayType: 'headache_free' } }))
      .toMatchObject({ dayType: 'headache_free' });
    expect(sendOrQueueMock.mock.calls[0]![0]).toMatchObject({
      url: '/api/diary/entry',
      method: 'PUT',
      kind: 'diary',
      label: '2026-11-16',
      body: { localDate: '2026-11-16', patch: { dayType: 'headache_free' } },
    });

    sendOrQueueMock.mockResolvedValueOnce({ queued: true, id: 'q4' });

    expect(await upsertDiaryEntry({ localDate: '2026-11-16', patch: { notes: 'x' } })).toBeNull();
  });

  it('keeps the server error code', async () => {
    const { upsertDiaryEntry } = await import('@/features/diary/diaryApi');
    sendOrQueueMock.mockResolvedValueOnce(sent(400, { error: 'Need migraine day', code: 'MIGRAINE_DAY_REQUIRED' }));

    await expect(upsertDiaryEntry({ localDate: '2026-11-16', patch: { dayType: 'headache_free' } }))
      .rejects
      .toMatchObject({ code: 'MIGRAINE_DAY_REQUIRED' });
  });
});

describe('logFactorEvent', () => {
  it('stamps now when no day is given, local noon for a given day', async () => {
    sendOrQueueMock.mockImplementation(async () => sent(201, {}));
    const { logFactorEvent } = await import('@/features/factors/factorsApi');

    await logFactorEvent({ displayName: 'stress', type: 'trigger' });
    await logFactorEvent({ displayName: 'rest', type: 'protector', localDate: '2026-11-14' });

    expect(sendOrQueueMock.mock.calls[0]![0]).toMatchObject({
      url: '/api/factors/log',
      kind: 'factor',
      body: { displayName: 'stress', type: 'trigger', occurredAt: NOW.toISOString() },
    });
    expect(sendOrQueueMock.mock.calls[1]![0].body.occurredAt).toBe(new Date(2026, 10, 14, 12).toISOString());
  });

  it('reports a queued factor', async () => {
    sendOrQueueMock.mockResolvedValue({ queued: true, id: 'q5' });
    const { logFactorEvent } = await import('@/features/factors/factorsApi');

    expect(await logFactorEvent({ displayName: 'stress', type: 'trigger' })).toEqual({ queued: true });
  });
});
