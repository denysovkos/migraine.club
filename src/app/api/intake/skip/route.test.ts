import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const hasHealthDataConsentMock = vi.fn();
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({
  hasHealthDataConsent: hasHealthDataConsentMock,
}));

const skipMock = vi.fn();
vi.mock('@/services/intake/IntakeService', () => ({
  intakeService: { get: vi.fn(), patchBlock: vi.fn(), skip: skipMock },
}));

describe('/api/intake/skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasHealthDataConsentMock.mockResolvedValue(true);
  });

  it('returns 401 when signed out', async () => {
    authMock.mockResolvedValue({ userId: null });

    const mod = await import('./route');
    const res = await mod.POST();

    expect(res.status).toBe(401);
    expect(skipMock).not.toHaveBeenCalled();
  });

  it('returns 403 when consent is missing', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    hasHealthDataConsentMock.mockResolvedValue(false);

    const mod = await import('./route');
    const res = await mod.POST();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Health data consent required', code: 'CONSENT_REQUIRED' });
    expect(skipMock).not.toHaveBeenCalled();
  });

  it('returns 200 with the updated DTO when signed in', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    skipMock.mockResolvedValue({ status: 'skipped', currentStep: 2 });

    const mod = await import('./route');
    const res = await mod.POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'skipped', currentStep: 2 });
    expect(skipMock).toHaveBeenCalledWith('user-1');
  });
});
