import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const consentMock = vi.fn();
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({ hasHealthDataConsent: consentMock }));

const createIntakeMock = vi.fn();
vi.mock('@/services/QuickAddService', () => ({
  quickAddService: { createMedicationIntake: createIntakeMock },
}));

const createAcuteDoseMock = vi.fn();
vi.mock('@/services/acuteMedications/AcuteDoseService', () => ({
  acuteDoseService: { create: createAcuteDoseMock },
}));

vi.mock('@/libs/DB', () => ({ db: {} }));
const warnMock = vi.fn();
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: warnMock, error: vi.fn() } }));

const NOW = new Date('2026-11-16T12:00:00.000Z');
const MED_ID = '00000000-0000-4000-8000-000000000001';
const INTAKE_ID = '00000000-0000-4000-8000-000000000002';
const DOSE_ID = '00000000-0000-4000-8000-000000000003';

function post(body: unknown) {
  return new Request('http://localhost/api/quick-add/medication-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/quick-add/medication-intake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    authMock.mockResolvedValue({ userId: 'user_a' });
    consentMock.mockResolvedValue(true);
    createIntakeMock.mockReset().mockResolvedValue({ intakeId: INTAKE_ID, linkedEpisodeId: 42, userMedicationId: MED_ID });
    createAcuteDoseMock.mockReset().mockResolvedValue({ doseId: DOSE_ID, attackId: 42 });
    warnMock.mockReset();
  });

  it('records the intake and the acute dose at the device-captured time in one request', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({
      userMedicationId: MED_ID,
      dose: '400',
      unit: 'mg',
      takenAt: '2026-11-16T10:30:00.000Z',
      recordAcuteDose: true,
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      intakeId: INTAKE_ID,
      linkedEpisodeId: 42,
      userMedicationId: MED_ID,
      acuteDoseId: DOSE_ID,
    });
    expect(createIntakeMock).toHaveBeenCalledWith({
      userId: 'user_a',
      input: expect.objectContaining({ takenAt: '2026-11-16T10:30:00.000Z', dose: '400' }),
    });
    expect(createAcuteDoseMock).toHaveBeenCalledWith('user_a', {
      medicationId: MED_ID,
      attackId: 42,
      takenAt: '2026-11-16T10:30:00.000Z',
      dose: '400',
      unit: 'mg',
      unitIsCustom: undefined,
    });
  });

  it('defaults the time to now and skips the acute dose unless asked (older clients)', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ userMedicationId: MED_ID }));

    expect(res.status).toBe(201);
    expect(createIntakeMock.mock.calls[0]![0].input.takenAt).toBe(NOW.toISOString());
    expect(createAcuteDoseMock).not.toHaveBeenCalled();
    expect((await res.json()).acuteDoseId).toBeUndefined();
  });

  it('still saves the intake when the acute-dose ledger write fails', async () => {
    createAcuteDoseMock.mockRejectedValue(new Error('ledger down'));
    const { POST } = await import('./route');
    const res = await POST(post({ userMedicationId: MED_ID, recordAcuteDose: true }));

    expect(res.status).toBe(201);
    expect((await res.json()).intakeId).toBe(INTAKE_ID);
    expect(warnMock).toHaveBeenCalled();
  });

  it('passes a null attack when the dose is not linked to an attack', async () => {
    createIntakeMock.mockResolvedValue({ intakeId: INTAKE_ID, linkedEpisodeId: null, userMedicationId: MED_ID });
    const { POST } = await import('./route');
    await POST(post({ userMedicationId: MED_ID, recordAcuteDose: true }));

    expect(createAcuteDoseMock.mock.calls[0]![1].attackId).toBeNull();
  });

  it.each([
    ['in the future', '2026-11-16T13:00:00.000Z'],
    ['older than 7 days', '2026-11-01T12:00:00.000Z'],
  ])('rejects a capture time %s', async (_label, takenAt) => {
    const { POST } = await import('./route');
    const res = await POST(post({ userMedicationId: MED_ID, takenAt }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TAKEN_AT');
    expect(createIntakeMock).not.toHaveBeenCalled();
  });

  it('answers 400 (not 500) for an invalid payload so a queued entry is not retried forever', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ dose: '1' }));

    expect(res.status).toBe(400);
    expect(createIntakeMock).not.toHaveBeenCalled();
  });

  it('requires health-data consent', async () => {
    consentMock.mockResolvedValue(false);
    const { POST } = await import('./route');
    const res = await POST(post({ userMedicationId: MED_ID }));

    expect(res.status).toBe(403);
  });
});
