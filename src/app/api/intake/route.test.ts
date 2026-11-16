import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const hasHealthDataConsentMock = vi.fn();
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({
  hasHealthDataConsent: hasHealthDataConsentMock,
}));

const getMock = vi.fn();
const patchBlockMock = vi.fn();
vi.mock('@/services/intake/IntakeService', () => ({
  intakeService: { get: getMock, patchBlock: patchBlockMock, skip: vi.fn() },
}));

describe('/api/intake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasHealthDataConsentMock.mockResolvedValue(true);
  });

  it('GET returns 401 when signed out', async () => {
    authMock.mockResolvedValue({ userId: null });

    const mod = await import('./route');
    const res = await mod.GET();

    expect(res.status).toBe(401);
  });

  it('GET returns 403 when consent is missing', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(false);

    const mod = await import('./route');
    const res = await mod.GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Health data consent required', code: 'CONSENT_REQUIRED' });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('GET returns the intake DTO', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getMock.mockResolvedValue({ status: 'in_progress', currentStep: 2 });

    const mod = await import('./route');
    const res = await mod.GET();

    expect(await res.json()).toMatchObject({ status: 'in_progress', currentStep: 2 });
  });

  it('PATCH returns 403 when consent is missing', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(false);

    const mod = await import('./route');
    const res = await mod.PATCH(new Request('http://localhost/api/intake', {
      method: 'PATCH',
      body: JSON.stringify({ block: 'frequency', value: { band: '4_7' } }),
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Health data consent required', code: 'CONSENT_REQUIRED' });
    expect(patchBlockMock).not.toHaveBeenCalled();
  });

  it('PATCH saves a single block', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    patchBlockMock.mockResolvedValue({ status: 'in_progress', currentStep: 1 });

    const mod = await import('./route');
    const res = await mod.PATCH(new Request('http://localhost/api/intake', {
      method: 'PATCH',
      body: JSON.stringify({ block: 'frequency', value: { band: '4_7' } }),
    }));

    expect(res.status).toBe(200);
    expect(patchBlockMock).toHaveBeenCalledWith('user-1', { block: 'frequency', value: { band: '4_7' } });
  });

  it('PATCH rejects a value that does not match its block', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });

    const mod = await import('./route');
    const res = await mod.PATCH(new Request('http://localhost/api/intake', {
      method: 'PATCH',
      body: JSON.stringify({ block: 'frequency', value: { keys: [], custom: [] } }),
    }));

    expect(res.status).toBe(400);
    expect(patchBlockMock).not.toHaveBeenCalled();
  });
});
